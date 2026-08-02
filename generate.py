from __future__ import annotations

import json
import math

import comfy.samplers
import torch.nn.functional as F
from comfy_execution.graph_utils import GraphBuilder

OUTPAINT_PROMPT_STRENGTH = 0.35


class NO8DNormalizeDecodedImage:
    """Convert VAE packed RGB output to a standard ComfyUI IMAGE tensor."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "normalize"
    CATEGORY = "NO8D-controls/internal"
    DEPRECATED = True

    @staticmethod
    def normalize(image):
        channels = image.shape[-1]
        if channels in (3, 4):
            return (image,)
        factor = math.isqrt(channels // 3) if channels % 3 == 0 else 0
        if factor < 1 or 3 * factor * factor != channels:
            raise RuntimeError(
                "NO8D-Generate: VAE Decode returned an unsupported packed image "
                f"with {channels} channels."
            )
        rgb = F.pixel_shuffle(image.movedim(-1, 1), factor).movedim(1, -1)
        return (rgb,)


class NO8DGenerate:
    """A UI shell that expands exclusively to ComfyUI core nodes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"rawLink": True}),
                "positive": ("CONDITIONING",),
                "vae": ("VAE", {"rawLink": True}),
                "latent": ("LATENT",),
                "steps": ("INT", {"default": 6, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler"}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "round": 0.01}),
                "mask_feather": ("INT", {"default": 50, "min": 0, "max": 100, "step": 1}),
                "canvas": ("NO8D_GENERATE_CANVAS",),
            },
            "optional": {"negative": ("CONDITIONING",)},
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "expand"
    OUTPUT_NODE = True
    CATEGORY = "NO8D-controls"

    def expand(
        self,
        model,
        positive,
        vae,
        latent,
        steps,
        cfg,
        sampler_name,
        scheduler,
        seed,
        denoise,
        mask_feather,
        canvas,
        negative=None,
        prompt=None,
        unique_id=None,
    ):
        graph = GraphBuilder()

        try:
            canvas_state = json.loads(canvas) if canvas else {}
        except (TypeError, json.JSONDecodeError):
            canvas_state = {}
        base_image_file = str(canvas_state.get("base_image_file") or "")
        source_image_file = str(canvas_state.get("source_image_file") or "")
        mask_image_file = str(canvas_state.get("mask_image_file") or "")
        manual_output_file = str(canvas_state.get("manual_output_file") or "")
        mask_active = bool(canvas_state.get("mask_active"))
        outpaint_active = bool(canvas_state.get("outpaint_active"))
        canvas_width = self._canvas_dimension(canvas_state.get("canvas_width"), 1024)
        canvas_height = self._canvas_dimension(canvas_state.get("canvas_height"), 1024)
        use_klein_reference = self._uses_flux2_klein_reference(prompt, model)
        uses_krea2_model = self._uses_krea2_model(prompt, model)
        # Krea2 editing always uses its native source-patch and grounded-image
        # conditioning. LoRAs may improve edit fidelity, but they must not
        # decide whether the source image reaches the model at all.
        use_krea2_reference = uses_krea2_model

        if manual_output_file:
            published = graph.node("LoadImage", image=manual_output_file)
            return {
                "result": (published.out(0),),
                "expand": graph.finalize(),
            }

        if mask_active and (not base_image_file or not mask_image_file):
            raise RuntimeError(
                "NO8D-Generate: the painted mask was not saved before execution. "
                "Please wait for the mask upload to finish and run the workflow again."
            )
        if negative is None:
            negative_node = graph.node("ConditioningZeroOut", conditioning=positive)
            negative = negative_node.out(0)

        sample_latent = None
        sample_model = model
        sample_positive = positive
        sample_negative = negative
        output_mask = None
        generated_image = None
        if mask_active:
            base = graph.node("LoadImage", image=base_image_file)
            mask = graph.node("LoadImageMask", image=mask_image_file, channel="red")
            encode_image = base.out(0)
            sample_mask = mask.out(0)
            grounding_image = encode_image
            spatial_reference_image = encode_image
            # Edit-model reference branches have their own native target
            # latent. Differential Diffusion belongs only to the generic
            # masked-sampling path.
            if not use_krea2_reference and not use_klein_reference:
                differential = graph.node(
                    "DifferentialDiffusion", model=model, strength=1.0,
                )
                sample_model = differential.out(0)
            output_mask = mask.out(0)
            if (uses_krea2_model or use_klein_reference) and source_image_file:
                source = graph.node("LoadImage", image=source_image_file)
                if uses_krea2_model:
                    grounding_image = source.out(0)
                if use_klein_reference:
                    # Klein's native ReferenceLatent is the clean source image,
                    # not the transformed target canvas with empty borders.
                    spatial_reference_image = source.out(0)
            if use_krea2_reference:
                if outpaint_active:
                    # The source-patch branch needs the expanded canvas so its
                    # tokens retain the exact placement used by outpaint.
                    # Grounded Encode is semantic rather than spatial: keep
                    # the intact pre-transform source selected above when it
                    # exists. Feeding the mostly-empty expanded canvas to both
                    # branches dilutes the visual reference as the outpaint
                    # area grows and makes large expansions drift away from
                    # the original scene. This split matches the established
                    # Krea2 Edit outpaint graph.
                    spatial_reference_image = encode_image
                else:
                    # An intact Identity Edit source tells the model to
                    # reconstruct the same masked content. Remove that content
                    # from the spatial source patch, just as Outpaint presents
                    # empty pixels outside the placed image. Denoise controls
                    # how completely that reference is removed; it must not
                    # make the final pixel composite translucent.
                    reference_mask = sample_mask
                    if denoise < 1.0:
                        reference_mask = self._scale_mask(
                            graph,
                            sample_mask,
                            denoise,
                            canvas_width,
                            canvas_height,
                        )
                    spatial_reference_image = self._masked_reference_image(
                        graph,
                        encode_image,
                        reference_mask,
                        canvas_width,
                        canvas_height,
                    )
                    # Do not leak the intact masked content back through
                    # Grounded Encode. Both Krea2 reference paths must see the
                    # same denoise-controlled hole; otherwise Identity Edit
                    # simply reconstructs the old pixels despite a cleared
                    # local target.
                    grounding_image = spatial_reference_image
            if uses_krea2_model:
                grounded = self._krea2_grounded_conditioning(
                    graph,
                    prompt,
                    positive,
                    grounding_image,
                    cfg,
                    edit_mode="outpaint" if outpaint_active else "inpaint",
                )
                if grounded is not None:
                    sample_positive, sample_negative = grounded
            inpaint_crop = self._manual_inpaint_crop_geometry(
                canvas_state, canvas_width, canvas_height, mask_feather,
            ) if not outpaint_active and not use_krea2_reference else None
            if outpaint_active:
                generated_image = self._sample_resized_region(
                    graph=graph,
                    pixels=encode_image,
                    mask=sample_mask,
                    output_width=canvas_width,
                    output_height=canvas_height,
                    model=sample_model,
                    positive=sample_positive,
                    negative=sample_negative,
                    vae=vae,
                    steps=steps,
                    cfg=cfg,
                    sampler_name=sampler_name,
                    scheduler=scheduler,
                    seed=seed,
                    denoise=denoise,
                    use_reference=use_klein_reference,
                    use_krea2_reference=use_krea2_reference,
                    reference_pixels=spatial_reference_image,
                    krea2_ref_boost=1.0,
                    # Keep Krea2's source patch, but sample the target through
                    # ComfyUI's native local-edit latent. An independent empty
                    # target lets the model reinterpret the whole composition
                    # and commonly enlarges the subject outside the preserved
                    # source rectangle. Clearing only the masked outpaint area
                    # keeps generated pixels in the source coordinate system.
                    krea2_local_target=True,
                    krea2_preserve_target=False,
                    # The aligned expanded-canvas latent is the same source
                    # patch accepted by Krea2 Edit Model Patch. Avoid a second
                    # raw-pixel fitting path that can choose a different scale.
                    krea2_source_latent_only=True,
                )
                # Keep output_mask active for every model family. The generated
                # Krea2 frame supplies the empty region, while the original
                # canvas remains authoritative in the untouched area. The same
                # continuous mask used for source conditioning performs the
                # final inward feather instead of creating a hard RGB seam.
            elif inpaint_crop is not None:
                generated_image = self._sample_cropped_inpaint(
                    graph=graph,
                    base_image=encode_image,
                    mask=sample_mask,
                    crop=inpaint_crop,
                    model=sample_model,
                    positive=sample_positive,
                    negative=sample_negative,
                    vae=vae,
                    steps=steps,
                    cfg=cfg,
                    sampler_name=sampler_name,
                    scheduler=scheduler,
                    seed=seed,
                    denoise=denoise,
                    use_reference=use_klein_reference,
                    use_krea2_reference=use_krea2_reference,
                )
                output_mask = None
            elif use_krea2_reference or use_klein_reference:
                generated_image = self._sample_resized_region(
                    graph=graph,
                    pixels=encode_image,
                    mask=sample_mask,
                    output_width=canvas_width,
                    output_height=canvas_height,
                    model=sample_model,
                    positive=sample_positive,
                    negative=sample_negative,
                    vae=vae,
                    steps=steps,
                    cfg=cfg,
                    sampler_name=sampler_name,
                    scheduler=scheduler,
                    seed=seed,
                    denoise=denoise,
                    use_reference=use_klein_reference,
                    use_krea2_reference=use_krea2_reference,
                    reference_pixels=spatial_reference_image,
                    krea2_ref_boost=1.0,
                    # Inpaint needs stricter spatial continuity than Outpaint:
                    # use ComfyUI's native cleared local target and continuous
                    # noise mask, while the masked frame-1 patch supplies Krea2
                    # identity/edit context. This keeps unchanged pixels in the
                    # same latent coordinate system across the feather band.
                    krea2_local_target=True,
                    krea2_source_latent_only=True,
                )
            else:
                encoded = graph.node("VAEEncode", pixels=encode_image, vae=vae)
                core_mask = graph.node("ThresholdMask", mask=sample_mask, value=0.99)
                inpaint_encoded = graph.node(
                    "VAEEncodeForInpaint",
                    pixels=encode_image,
                    vae=vae,
                    mask=core_mask.out(0),
                    grow_mask_by=6,
                )
                blended = graph.node(
                    "LatentBlend",
                    samples1=encoded.out(0),
                    samples2=inpaint_encoded.out(0),
                    blend_factor=self._original_latent_blend(denoise),
                )
                masked_samples = blended.out(0)
                masked_latent = graph.node(
                    "SetLatentNoiseMask",
                    samples=masked_samples,
                    mask=sample_mask,
                )
                sample_latent = masked_latent.out(0)
        else:
            # The external latent is used only for the initial T2I pass.
            # Once a canvas mask exists, the saved generated image becomes the
            # source and the model-specific inpaint/outpaint path takes over.
            sample_latent = latent

        if generated_image is None:
            sampler = graph.node(
                "KSampler",
                model=sample_model,
                seed=seed,
                steps=steps,
                cfg=cfg,
                sampler_name=sampler_name,
                scheduler=scheduler,
                positive=sample_positive,
                negative=sample_negative,
                latent_image=sample_latent,
                denoise=denoise,
            )
            decode = graph.node("VAEDecode", samples=sampler.out(0), vae=vae)
            normalized = graph.node("NO8DNormalizeDecodedImage", image=decode.out(0))
            if mask_active:
                sized = graph.node(
                    "ImageScale",
                    image=normalized.out(0),
                    upscale_method="lanczos",
                    width=canvas_width,
                    height=canvas_height,
                    crop="disabled",
                )
                generated_image = sized.out(0)
            else:
                # Never force the decoded T2I result into the canvas toolbar's
                # previous dimensions. The connected latent owns initial size.
                generated_image = normalized.out(0)
        if output_mask is not None:
            composite = graph.node(
                "ImageCompositeMasked",
                destination=base.out(0),
                source=generated_image,
                x=0,
                y=0,
                resize_source=False,
                mask=output_mask,
            )
            final_image = composite.out(0)
        else:
            final_image = generated_image
        # Always create this node's own native preview. Its expanded
        # display_node is NO8D-Generate, so the frontend never has to borrow
        # an image emitted by a downstream save/preview/transform node.
        graph.node("PreviewImage", images=final_image)

        return {
            # Keep this node's result independent from whether a downstream
            # node is present in the queued prompt. The frontend may suppress
            # downstream nodes while automatic output is disabled, but that
            # must not change this node's expansion or invalidate its cache.
            "result": (final_image,),
            "expand": graph.finalize(),
        }

    @staticmethod
    def _manual_inpaint_crop_geometry(
        canvas_state, canvas_width, canvas_height, mask_feather,
    ):
        strokes = canvas_state.get("strokes")
        if not isinstance(strokes, list):
            return None

        bounds = []
        for stroke in strokes:
            if not isinstance(stroke, dict) or stroke.get("op") == "subtract":
                continue
            points = stroke.get("points")
            if not isinstance(points, list):
                continue
            valid_points = []
            for point in points:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    continue
                try:
                    valid_points.append((float(point[0]), float(point[1])))
                except (TypeError, ValueError):
                    continue
            if not valid_points:
                continue
            min_x = min(point[0] for point in valid_points)
            min_y = min(point[1] for point in valid_points)
            max_x = max(point[0] for point in valid_points)
            max_y = max(point[1] for point in valid_points)
            if stroke.get("kind") == "lasso":
                diameter = max(1.0, min(max_x - min_x, max_y - min_y))
                core_radius = 0.0
            else:
                diameter = max(1.0, float(stroke.get("brushSize") or 1.0))
                core_radius = diameter * 0.5
            feather_radius = diameter * 0.5 * max(
                0.0, min(100.0, float(mask_feather)),
            ) / 100.0
            radius = core_radius + feather_radius
            bounds.append((
                min_x - radius,
                min_y - radius,
                max_x + radius,
                max_y + radius,
            ))
        if not bounds:
            return None

        left = min(bound[0] for bound in bounds)
        top = min(bound[1] for bound in bounds)
        right = max(bound[2] for bound in bounds)
        bottom = max(bound[3] for bound in bounds)
        content_size = max(right - left, bottom - top)
        context = max(64, min(256, round(content_size * 0.25)))
        left = max(0, math.floor((left - context) / 8) * 8)
        top = max(0, math.floor((top - context) / 8) * 8)
        right = min(canvas_width, math.ceil((right + context) / 8) * 8)
        bottom = min(canvas_height, math.ceil((bottom + context) / 8) * 8)
        width = right - left
        height = bottom - top
        if width < 16 or height < 16:
            return None
        if width * height >= canvas_width * canvas_height * 0.9:
            return None
        return {"x": left, "y": top, "width": width, "height": height}

    @classmethod
    def _sample_cropped_inpaint(
        cls,
        *,
        graph,
        base_image,
        mask,
        crop,
        model,
        positive,
        negative,
        vae,
        steps,
        cfg,
        sampler_name,
        scheduler,
        seed,
        denoise,
        use_reference,
        use_krea2_reference=False,
        krea2_local_target=False,
        krea2_ref_boost=4.0,
    ):
        cropped_image = graph.node(
            "ImageCrop",
            image=base_image,
            width=crop["width"],
            height=crop["height"],
            x=crop["x"],
            y=crop["y"],
        )
        mask_image = graph.node("MaskToImage", mask=mask)
        cropped_mask_image = graph.node(
            "ImageCrop",
            image=mask_image.out(0),
            width=crop["width"],
            height=crop["height"],
            x=crop["x"],
            y=crop["y"],
        )
        cropped_mask = graph.node(
            "ImageToMask", image=cropped_mask_image.out(0), channel="red",
        )
        generated = cls._sample_resized_region(
            graph=graph,
            pixels=cropped_image.out(0),
            mask=cropped_mask.out(0),
            output_width=crop["width"],
            output_height=crop["height"],
            model=model,
            positive=positive,
            negative=negative,
            vae=vae,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            seed=seed,
            denoise=denoise,
            use_reference=use_reference,
            use_krea2_reference=use_krea2_reference,
            reference_pixels=cropped_image.out(0),
            regional_conditioning=False,
            blend_original=not use_reference,
            krea2_local_target=krea2_local_target,
            krea2_ref_boost=krea2_ref_boost,
        )
        composite_mask = cropped_mask.out(0)
        if use_krea2_reference and denoise < 1.0:
            composite_mask = cls._scale_mask(
                graph,
                composite_mask,
                denoise,
                crop["width"],
                crop["height"],
            )
        stitched = graph.node(
            "ImageCompositeMasked",
            destination=base_image,
            source=generated,
            x=crop["x"],
            y=crop["y"],
            resize_source=False,
            mask=composite_mask,
        )
        return stitched.out(0)

    @staticmethod
    def _sampling_dimensions(width, height):
        width = max(16, int(width))
        height = max(16, int(height))
        short_side = min(width, height)
        long_side = max(width, height)
        scale = 512 / short_side if short_side < 512 else 1.0
        if long_side * scale > 1536:
            scale = 1536 / long_side
        sample_width = max(16, round(width * scale / 8) * 8)
        sample_height = max(16, round(height * scale / 8) * 8)
        return sample_width, sample_height

    @classmethod
    def _sample_resized_region(
        cls,
        *,
        graph,
        pixels,
        mask,
        output_width,
        output_height,
        model,
        positive,
        negative,
        vae,
        steps,
        cfg,
        sampler_name,
        scheduler,
        seed,
        denoise,
        use_reference=False,
        use_krea2_reference=False,
        reference_pixels=None,
        regional_conditioning=True,
        blend_original=False,
        krea2_ref_boost=4.0,
        krea2_local_target=False,
        krea2_preserve_target=False,
        krea2_source_latent_only=False,
    ):
        sample_width, sample_height = cls._sampling_dimensions(
            output_width, output_height,
        )
        sample_pixels = pixels
        sample_mask = mask
        resized = (sample_width, sample_height) != (output_width, output_height)
        if resized:
            scaled_image = graph.node(
                "ImageScale",
                image=pixels,
                upscale_method="lanczos",
                width=sample_width,
                height=sample_height,
                crop="disabled",
            )
            mask_image = graph.node("MaskToImage", mask=mask)
            scaled_mask_image = graph.node(
                "ImageScale",
                image=mask_image.out(0),
                upscale_method="bilinear",
                width=sample_width,
                height=sample_height,
                crop="disabled",
            )
            scaled_mask = graph.node(
                "ImageToMask", image=scaled_mask_image.out(0), channel="red",
            )
            sample_pixels = scaled_image.out(0)
            sample_mask = scaled_mask.out(0)

        generated = cls._sample_native_inpaint(
            graph=graph,
            pixels=sample_pixels,
            mask=sample_mask,
            model=model,
            positive=positive,
            negative=negative,
            vae=vae,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            seed=seed,
            denoise=denoise,
            use_reference=use_reference,
            use_krea2_reference=use_krea2_reference,
            reference_pixels=reference_pixels,
            regional_conditioning=regional_conditioning,
            blend_original=blend_original,
            krea2_ref_boost=krea2_ref_boost,
            krea2_local_target=krea2_local_target,
            krea2_preserve_target=krea2_preserve_target,
            krea2_source_latent_only=krea2_source_latent_only,
            target_width=sample_width,
            target_height=sample_height,
        )
        if not resized:
            return generated
        restored = graph.node(
            "ImageScale",
            image=generated,
            upscale_method="lanczos",
            width=output_width,
            height=output_height,
            crop="disabled",
        )
        return restored.out(0)

    @staticmethod
    def _canvas_dimension(value, default):
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = default
        return max(16, min(16384, round(value / 8) * 8))

    @staticmethod
    def _original_latent_blend(denoise):
        """Return how much source latent remains inside the editable core."""
        try:
            denoise = float(denoise)
        except (TypeError, ValueError):
            denoise = 1.0
        return round(1.0 - max(0.0, min(1.0, denoise)), 4)

    @staticmethod
    def _scale_mask(graph, mask, strength, width, height):
        """Scale a mask with ComfyUI's native mask-composite nodes."""
        strength = max(0.0, min(1.0, float(strength)))
        solid = graph.node(
            "SolidMask",
            value=strength,
            width=int(width),
            height=int(height),
        )
        scaled = graph.node(
            "MaskComposite",
            destination=mask,
            source=solid.out(0),
            x=0,
            y=0,
            operation="multiply",
        )
        return scaled.out(0)

    @staticmethod
    def _sample_native_inpaint(
        *, graph, pixels, mask, model, positive, negative, vae, steps, cfg,
        sampler_name, scheduler, seed, denoise, use_reference=False,
        use_krea2_reference=False, reference_pixels=None,
        regional_conditioning=True, blend_original=False,
        krea2_ref_boost=4.0,
        krea2_local_target=False,
        krea2_preserve_target=False,
        krea2_source_latent_only=False,
        target_width=None, target_height=None,
    ):
        krea_source = None
        if use_krea2_reference:
            if reference_pixels is None:
                reference_pixels = pixels
            krea_source = graph.node(
                "VAEEncode", pixels=reference_pixels, vae=vae,
            )
        if use_reference:
            # Match ComfyUI's official Flux.2 Klein edit graph: the encoded
            # source is conditioning only, while sampling starts from a
            # separate empty Flux.2 target latent at the requested output
            # dimensions. Encoding an expanded black canvas as the target
            # causes those black borders to be reconstructed unchanged.
            reference_encoded = graph.node(
                "VAEEncode",
                pixels=reference_pixels if reference_pixels is not None else pixels,
                vae=vae,
            )
            positive, negative = NO8DGenerate._reference_conditioning(
                graph, positive, negative, reference_encoded.out(0),
            )
            encoded = graph.node(
                "EmptyFlux2LatentImage",
                width=int(target_width),
                height=int(target_height),
                batch_size=1,
            )
        elif use_krea2_reference and krea2_preserve_target:
            encoded = graph.node("VAEEncode", pixels=pixels, vae=vae)
        elif use_krea2_reference and not krea2_local_target:
            encoded = graph.node(
                "EmptySD3LatentImage",
                width=int(target_width),
                height=int(target_height),
                batch_size=1,
            )
        else:
            if regional_conditioning and not use_krea2_reference:
                positive = NO8DGenerate._regional_outpaint_conditioning(
                    graph, positive, mask,
                )
            core_mask = graph.node("ThresholdMask", mask=mask, value=0.99)
            encoded = graph.node(
                "VAEEncodeForInpaint",
                pixels=pixels,
                vae=vae,
                mask=core_mask.out(0),
                grow_mask_by=6,
            )
        samples = encoded.out(0)
        if use_krea2_reference:
            reference_inputs = {
                "model": model,
                "source_latent": krea_source.out(0),
                "ref_boost": float(krea2_ref_boost),
            }
            if not krea2_source_latent_only:
                reference_inputs.update({
                    "vae": vae,
                    "source_image": reference_pixels,
                })
            reference_model = graph.node(
                "NO8DKrea2ReferenceModel",
                **reference_inputs,
            )
            model = reference_model.out(0)
        if blend_original and not use_krea2_reference:
            original = krea_source or graph.node("VAEEncode", pixels=pixels, vae=vae)
            blended = graph.node(
                "LatentBlend",
                samples1=original.out(0),
                samples2=encoded.out(0),
                blend_factor=NO8DGenerate._original_latent_blend(denoise),
            )
            samples = blended.out(0)
        if (
            use_krea2_reference
            and not krea2_local_target
            and not krea2_preserve_target
        ):
            latent = samples
            sample_denoise = 1.0
        else:
            # Preserve the continuous mask. SetLatentNoiseMask and ComfyUI's
            # native DifferentialDiffusion use it as per-pixel strength.
            latent = graph.node(
                "SetLatentNoiseMask", samples=samples, mask=mask,
            ).out(0)
            sample_denoise = 1.0 if (use_reference or use_krea2_reference) else denoise
        sampler = graph.node(
            "KSampler",
            model=model,
            seed=seed,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            positive=positive,
            negative=negative,
            latent_image=latent,
            denoise=sample_denoise,
        )
        decode = graph.node("VAEDecode", samples=sampler.out(0), vae=vae)
        normalized = graph.node("NO8DNormalizeDecodedImage", image=decode.out(0))
        # Some Krea2 workflows intentionally use a packed 2x image VAE. After
        # unpacking its 12-channel result, restore the exact canvas/crop size
        # with ComfyUI's native scaler before compositing or previewing.
        if target_width is not None and target_height is not None:
            sized = graph.node(
                "ImageScale",
                image=normalized.out(0),
                upscale_method="lanczos",
                width=int(target_width),
                height=int(target_height),
                crop="disabled",
            )
            return sized.out(0)
        return normalized.out(0)

    @staticmethod
    def _masked_reference_image(graph, image, mask, width, height):
        empty = graph.node(
            "EmptyImage",
            width=int(width),
            height=int(height),
            batch_size=1,
            color=0,
        )
        masked = graph.node(
            "ImageCompositeMasked",
            destination=image,
            source=empty.out(0),
            x=0,
            y=0,
            resize_source=False,
            mask=mask,
        )
        return masked.out(0)

    @staticmethod
    def _reference_conditioning(graph, positive, negative, reference_latent):
        positive_reference = graph.node(
            "ReferenceLatent",
            conditioning=positive,
            latent=reference_latent,
        )
        negative_reference = graph.node(
            "ReferenceLatent",
            conditioning=negative,
            latent=reference_latent,
        )
        return positive_reference.out(0), negative_reference.out(0)

    @classmethod
    def _krea2_grounded_conditioning(
        cls,
        graph,
        prompt,
        positive,
        image,
        cfg,
        edit_mode=None,
    ):
        grounding = cls._krea2_grounding_inputs(prompt, positive)
        if grounding is None:
            return None
        text = str(grounding["text"] or "").strip()
        if edit_mode == "outpaint":
            # Keep Krea2 outpaint spatially driven. Reusing either the T2I
            # subject prompt or round-dependent prose can ask the model to
            # redraw complete objects in the newly exposed area.
            grounded_text = ""
        elif edit_mode == "inpaint":
            # Match the proven Identity Edit workflow: the source image carries
            # the edit context and both grounded branches use empty text. The
            # original T2I prompt must not ask the model to reconstruct the
            # same masked object.
            grounded_text = ""
        else:
            instruction = "Edit the source image according to the instruction."
            grounded_text = f"{instruction} {text}".strip()
        grounded_positive = graph.node(
            "NO8DKrea2GroundedEncode",
            clip=grounding["clip"],
            text=grounded_text,
            image=image,
        )
        if abs(float(cfg) - 1.0) < 1e-6:
            grounded_negative = graph.node(
                "ConditioningZeroOut",
                conditioning=grounded_positive.out(0),
            )
        else:
            grounded_negative = graph.node(
                "NO8DKrea2GroundedEncode",
                clip=grounding["clip"],
                text="",
                image=image,
            )
        return grounded_positive.out(0), grounded_negative.out(0)

    @staticmethod
    def _uses_flux2_klein_reference(prompt, model):
        """Detect Klein from active model-loader fields, not saved UI state."""
        return NO8DGenerate._model_loader_branch_contains(
            prompt, model, "flux2klein",
        )

    @staticmethod
    def _uses_krea2_model(prompt, model):
        """Detect Krea2 from active model-loader fields, not LoRA history."""
        return NO8DGenerate._model_loader_branch_contains(
            prompt, model, "krea2",
        )

    @staticmethod
    def _model_loader_branch_contains(prompt, model, marker):
        """Search only fields that select the base diffusion architecture.

        UI nodes may serialize disabled LoRAs, picker history, titles, and other
        inactive text into the API prompt. Searching the whole node JSON makes
        a Klein loader look like Krea2 merely because a disabled Krea2 LoRA is
        still listed in its stack. Model-family routing must follow the active
        UNet/checkpoint filename instead.
        """
        if not isinstance(prompt, dict):
            return False
        if not isinstance(model, (list, tuple)) or len(model) != 2:
            return False

        marker = "".join(character for character in marker.lower() if character.isalnum())
        model_name_keys = {
            "unetname",
            "ckptname",
            "checkpointname",
            "modelname",
            "modelpath",
            "diffusionmodel",
            "diffusionmodelname",
        }
        pending = [str(model[0])]
        visited = set()
        while pending:
            node_id = pending.pop()
            if node_id in visited:
                continue
            visited.add(node_id)
            node = prompt.get(node_id)
            if node is None:
                try:
                    node = prompt.get(int(node_id))
                except (TypeError, ValueError):
                    node = None
            if not isinstance(node, dict):
                continue

            class_type = str(node.get("class_type") or "")
            compact_class = "".join(
                character for character in class_type.lower()
                if character.isalnum()
            )
            if marker in compact_class and "loader" in compact_class:
                return True

            for key, value in (node.get("inputs") or {}).items():
                compact_key = "".join(
                    character for character in str(key).lower()
                    if character.isalnum()
                )
                if compact_key in model_name_keys and isinstance(value, str):
                    compact_value = "".join(
                        character for character in value.lower()
                        if character.isalnum()
                    )
                    if marker in compact_value:
                        return True
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    upstream_id = str(value[0])
                    if upstream_id not in visited:
                        pending.append(upstream_id)
        return False

    @staticmethod
    def _regional_outpaint_conditioning(graph, conditioning, outpaint_mask):
        known_mask = graph.node("InvertMask", mask=outpaint_mask)
        known = graph.node(
            "ConditioningSetMask",
            conditioning=conditioning,
            mask=known_mask.out(0),
            strength=1.0,
            set_cond_area="default",
        )
        reduced = graph.node(
            "ConditioningMultiply",
            conditioning=conditioning,
            multiplier=OUTPAINT_PROMPT_STRENGTH,
        )
        outside = graph.node(
            "ConditioningSetMask",
            conditioning=reduced.out(0),
            mask=outpaint_mask,
            strength=1.0,
            set_cond_area="default",
        )
        combined = graph.node(
            "ConditioningCombine",
            conditioning_1=known.out(0),
            conditioning_2=outside.out(0),
        )
        return combined.out(0)

    @staticmethod
    def _krea2_grounding_inputs(prompt, positive):
        """Recover one unambiguous native CLIPTextEncode upstream."""
        if not isinstance(prompt, dict):
            return None
        if not isinstance(positive, (list, tuple)) or len(positive) != 2:
            return None

        pending = [str(positive[0])]
        visited = set()
        candidates = []
        while pending:
            node_id = pending.pop()
            if node_id in visited:
                continue
            visited.add(node_id)
            node = prompt.get(node_id)
            if node is None:
                try:
                    node = prompt.get(int(node_id))
                except (TypeError, ValueError):
                    node = None
            if not isinstance(node, dict):
                continue
            if str(node.get("class_type") or "") == "CLIPTextEncode":
                candidates.append(node)
                continue
            for value in (node.get("inputs") or {}).values():
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    pending.append(str(value[0]))

        if len(candidates) != 1:
            return None
        inputs = candidates[0].get("inputs") or {}
        clip = inputs.get("clip")
        text = inputs.get("text")
        if not isinstance(clip, (list, tuple)) or len(clip) != 2:
            return None
        if not isinstance(text, (str, list, tuple)):
            return None
        return {"clip": clip, "text": text}

NODE_CLASS_MAPPINGS = {
    "NO8DGenerate": NO8DGenerate,
    "NO8DNormalizeDecodedImage": NO8DNormalizeDecodedImage,
}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DGenerate": "NO8D-Generate"}

import importlib.util
import pathlib
import sys
import types
import unittest


class _GraphNode:
    def __init__(self, node_id, class_type, inputs):
        self.node_id = node_id
        self.class_type = class_type
        self.inputs = inputs

    def out(self, index):
        return [self.node_id, index]


class _GraphBuilder:
    def __init__(self):
        self.nodes = []

    def node(self, class_type, **inputs):
        node = _GraphNode(str(len(self.nodes) + 1), class_type, inputs)
        self.nodes.append(node)
        return node

    def finalize(self):
        return {
            node.node_id: {"class_type": node.class_type, "inputs": node.inputs}
            for node in self.nodes
        }


def _load_generate_module():
    class _PreviewImage:
        OUTPUT_NODE = True

    comfy = types.ModuleType("comfy")
    comfy.samplers = types.SimpleNamespace(
        KSampler=types.SimpleNamespace(SAMPLERS=["euler"], SCHEDULERS=["simple"])
    )
    execution = types.ModuleType("comfy_execution")
    graph_utils = types.ModuleType("comfy_execution.graph_utils")
    graph_utils.GraphBuilder = _GraphBuilder
    nodes = types.ModuleType("nodes")
    nodes.NODE_CLASS_MAPPINGS = {"PreviewImage": _PreviewImage}

    old_modules = {
        name: sys.modules.get(name)
        for name in (
            "comfy",
            "comfy.samplers",
            "comfy_execution",
            "comfy_execution.graph_utils",
            "nodes",
        )
    }
    sys.modules["comfy"] = comfy
    sys.modules["comfy.samplers"] = comfy.samplers
    sys.modules["comfy_execution"] = execution
    sys.modules["comfy_execution.graph_utils"] = graph_utils
    sys.modules["nodes"] = nodes
    try:
        path = pathlib.Path(__file__).resolve().parents[1] / "generate.py"
        spec = importlib.util.spec_from_file_location("no8d_generate_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in old_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


GENERATE = _load_generate_module()


class GenerateExpansionTests(unittest.TestCase):
    def setUp(self):
        self.node = GENERATE.NO8DGenerate()
        self.inputs = {
            "model": ["model", 0],
            "positive": ["positive", 0],
            "vae": ["vae", 0],
            "latent": ["latent", 0],
            "steps": 6,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "simple",
            "seed": 1,
            "denoise": 1.0,
            "mask_feather": 50,
            "prompt": {"2": {"inputs": {"images": ["1", 0]}}},
            "unique_id": "1",
        }

    def expand_classes(self, canvas):
        result = self.node.expand(canvas=canvas, **self.inputs)
        return [node["class_type"] for node in result["expand"].values()]

    def use_klein_model(self):
        self.inputs["model"] = ["10", 0]
        self.inputs["prompt"] = {
            "10": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "flux-2-klein-4b-fp8.safetensors",
                },
            },
            "2": {"inputs": {"images": ["1", 0]}},
        }

    def use_krea2_model(self):
        self.inputs["model"] = ["10", 0]
        self.inputs["prompt"] = {
            "10": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": "krea2_turbo_fp8.safetensors"},
            },
            "2": {"inputs": {"images": ["1", 0]}},
        }

    def use_krea2_identity_model(self):
        self.inputs["model"] = ["11", 0]
        self.inputs["prompt"] = {
            "10": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": "krea2_turbo_fp8.safetensors"},
            },
            "11": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": ["10", 0],
                    "lora_name": "krea2_identity_edit_v1_2.safetensors",
                },
            },
            "2": {"inputs": {"images": ["1", 0]}},
        }

    def test_normal_generation_uses_native_sampling_and_rgb_normalization(self):
        self.assertEqual(
            self.expand_classes("{}"),
            [
                "ConditioningZeroOut",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "PreviewImage",
            ],
        )

    def test_initial_t2i_uses_connected_latent_without_image_encode(self):
        result = self.node.expand(canvas="{}", **self.inputs)
        expanded = result["expand"]
        classes = [node["class_type"] for node in expanded.values()]
        self.assertNotIn("VAEEncode", classes)
        self.assertNotIn("EmptyLatentImage", classes)
        self.assertNotIn("ImageScale", classes)
        sampler = next(
            node for node in expanded.values()
            if node["class_type"] == "KSampler"
        )
        self.assertEqual(sampler["inputs"]["latent_image"], ["latent", 0])
        self.assertEqual(sampler["inputs"]["denoise"], self.inputs["denoise"])

    def test_klein_initial_t2i_uses_connected_latent_without_reference(self):
        self.use_klein_model()
        result = self.node.expand(canvas="{}", **self.inputs)
        classes = [node["class_type"] for node in result["expand"].values()]
        self.assertNotIn("ReferenceLatent", classes)
        self.assertNotIn("EmptyFlux2LatentImage", classes)
        sampler = next(
            node for node in result["expand"].values()
            if node["class_type"] == "KSampler"
        )
        self.assertEqual(sampler["inputs"]["latent_image"], ["latent", 0])

    def test_canvas_mask_takes_priority_over_initial_latent(self):
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true}'
            ),
            **self.inputs,
        )
        sampler = next(
            node for node in result["expand"].values()
            if node["class_type"] == "KSampler"
        )
        self.assertNotEqual(sampler["inputs"]["latent_image"], ["latent", 0])

    def test_klein_normal_generation_does_not_replace_connected_latent(self):
        self.use_klein_model()
        classes = self.expand_classes("{}")
        self.assertNotIn("EmptyFlux2LatentImage", classes)
        self.assertNotIn("EmptyLatentImage", classes)

    def test_krea2_normal_generation_does_not_replace_connected_latent(self):
        self.use_krea2_model()
        classes = self.expand_classes("{}")
        self.assertNotIn("EmptySD3LatentImage", classes)
        self.assertNotIn("EmptyLatentImage", classes)
        self.assertNotIn("EmptyFlux2LatentImage", classes)

    def test_plain_krea2_inpaint_does_not_apply_identity_reference_patch(self):
        self.use_krea2_model()
        classes = self.expand_classes(
            '{"base_image_file":"base.png","mask_image_file":"mask.png",'
            '"mask_active":true}'
        )
        self.assertNotIn("NO8DKrea2ReferenceModel", classes)
        self.assertEqual(classes.count("KSampler"), 1)
        self.assertNotIn("NO8DConditionalKSampler", classes)

    def test_krea2_identity_inpaint_uses_independent_empty_target(self):
        self.use_krea2_identity_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        patch_id, patch = next(
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "NO8DKrea2ReferenceModel"
        )
        source_id = patch["inputs"]["source_latent"][0]
        self.assertEqual(expanded[source_id]["class_type"], "VAEEncode")
        masked_reference_id = expanded[source_id]["inputs"]["pixels"][0]
        masked_reference = expanded[masked_reference_id]
        self.assertEqual(masked_reference["class_type"], "ImageCompositeMasked")
        self.assertEqual(
            expanded[masked_reference["inputs"]["source"][0]]["class_type"],
            "EmptyImage",
        )
        self.assertEqual(
            expanded[masked_reference["inputs"]["mask"][0]]["class_type"],
            "LoadImageMask",
        )
        self.assertNotIn("vae", patch["inputs"])
        self.assertNotIn("source_image", patch["inputs"])
        self.assertEqual(patch["inputs"]["ref_boost"], 1.0)
        sampler = next(
            node for node in expanded.values()
            if node["class_type"] == "KSampler"
        )
        self.assertEqual(sampler["inputs"]["model"], [patch_id, 0])
        target_id = sampler["inputs"]["latent_image"][0]
        self.assertEqual(expanded[target_id]["class_type"], "EmptySD3LatentImage")
        self.assertEqual(sampler["inputs"]["denoise"], 1.0)
        classes = [node["class_type"] for node in expanded.values()]
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("SetLatentNoiseMask", classes)
        self.assertIn("EmptySD3LatentImage", classes)
        self.assertNotIn("DifferentialDiffusion", classes)
        self.assertEqual(classes.count("ImageCompositeMasked"), 2)

    def test_krea2_identity_outpaint_uses_masked_canvas_target_without_pixel_paste(self):
        self.use_krea2_identity_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":1024,"canvas_height":1024,'
                '"image_transform":{"x":128,"y":128,"width":768,"height":768}}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        patches = [
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "NO8DKrea2ReferenceModel"
        ]
        samplers = [
            node for node in nodes if node["class_type"] == "KSampler"
        ]
        self.assertEqual(len(patches), 1)
        self.assertEqual(len(samplers), 1)
        patch_id, patch = patches[0]
        sampler = samplers[0]
        source_id = patch["inputs"]["source_latent"][0]
        self.assertEqual(expanded[source_id]["class_type"], "VAEEncode")
        self.assertEqual(patch["inputs"]["ref_boost"], 1.0)
        self.assertNotIn("vae", patch["inputs"])
        self.assertNotIn("source_image", patch["inputs"])
        self.assertEqual(sampler["inputs"]["model"], [patch_id, 0])
        target_id = sampler["inputs"]["latent_image"][0]
        self.assertEqual(expanded[target_id]["class_type"], "SetLatentNoiseMask")
        encoded_id = expanded[target_id]["inputs"]["samples"][0]
        self.assertEqual(expanded[encoded_id]["class_type"], "VAEEncode")
        self.assertEqual(sampler["inputs"]["denoise"], 1.0)
        classes = [node["class_type"] for node in nodes]
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("EmptySD3LatentImage", classes)
        self.assertIn("SetLatentNoiseMask", classes)
        self.assertNotIn("DifferentialDiffusion", classes)
        self.assertNotIn("ImageCompositeMasked", classes)

    def test_krea2_identity_outpaint_does_not_repeat_the_t2i_subject_prompt(self):
        self.use_krea2_identity_model()
        self.inputs["positive"] = ["12", 0]
        self.inputs["prompt"]["12"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["9", 0],
                "text": "extend the same scene beyond the source image",
            },
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png",'
                '"source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"outpaint_active":true,"canvas_width":1024,'
                '"canvas_height":1024}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        grounded = [
            node for node in expanded.values()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        ]
        self.assertEqual(len(grounded), 1)
        self.assertTrue(all(node["inputs"]["clip"] == ["9", 0] for node in grounded))
        self.assertEqual(
            [node["inputs"]["text"] for node in grounded],
            [""],
        )
        source_load_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImage"
            and node["inputs"]["image"] == "source.png"
        )
        self.assertTrue(all(
            node["inputs"]["image"] == [source_load_id, 0]
            for node in grounded
        ))
        sampler = next(
            node for node in expanded.values() if node["class_type"] == "KSampler"
        )
        masked_id = sampler["inputs"]["latent_image"][0]
        self.assertEqual(expanded[masked_id]["class_type"], "SetLatentNoiseMask")
        target_id = expanded[masked_id]["inputs"]["samples"][0]
        self.assertEqual(expanded[target_id]["class_type"], "VAEEncode")
        grounded_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        )
        zero_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "ConditioningZeroOut"
            and node["inputs"].get("conditioning") == [grounded_id, 0]
        )
        self.assertEqual(sampler["inputs"]["positive"], [grounded_id, 0])
        self.assertEqual(sampler["inputs"]["negative"], [zero_id, 0])

    def test_krea2_grounded_negative_is_encoded_when_cfg_is_above_one(self):
        self.use_krea2_identity_model()
        self.inputs["cfg"] = 2.0
        self.inputs["positive"] = ["12", 0]
        self.inputs["prompt"]["12"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["9", 0], "text": "extend the same scene"},
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png",'
                '"source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"outpaint_active":true,"canvas_width":1024,'
                '"canvas_height":1024}'
            ),
            **self.inputs,
        )
        grounded = [
            node for node in result["expand"].values()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        ]
        self.assertEqual(
            [node["inputs"]["text"] for node in grounded],
            ["", ""],
        )

    def test_krea2_grounding_follows_one_conditioning_passthrough_chain(self):
        prompt = {
            "30": {
                "class_type": "NO8DPromptView",
                "inputs": {"conditioning": ["20", 0]},
            },
            "20": {
                "class_type": "ConditioningSetTimestepRange",
                "inputs": {"conditioning": ["12", 0], "start": 0.0, "end": 1.0},
            },
            "12": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["9", 0], "text": "extend the same scene"},
            },
        }
        self.assertEqual(
            self.node._krea2_grounding_inputs(prompt, ["30", 0]),
            {"clip": ["9", 0], "text": "extend the same scene"},
        )

    def test_krea2_grounding_rejects_ambiguous_combined_conditioning(self):
        prompt = {
            "30": {
                "class_type": "ConditioningCombine",
                "inputs": {
                    "conditioning_1": ["12", 0],
                    "conditioning_2": ["13", 0],
                },
            },
            "12": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["9", 0], "text": "first"},
            },
            "13": {
                "class_type": "CLIPTextEncode",
                "inputs": {"clip": ["9", 0], "text": "second"},
            },
        }
        self.assertIsNone(
            self.node._krea2_grounding_inputs(prompt, ["30", 0]),
        )

    def test_krea2_identity_initial_t2i_waits_for_a_canvas_mask(self):
        self.use_krea2_identity_model()
        result = self.node.expand(canvas="{}", **self.inputs)
        classes = [node["class_type"] for node in result["expand"].values()]
        self.assertNotIn("NO8DKrea2ReferenceModel", classes)
        self.assertNotIn("VAEEncode", classes)
        self.assertNotIn("EmptySD3LatentImage", classes)
        sampler = next(
            node for node in result["expand"].values()
            if node["class_type"] == "KSampler"
        )
        self.assertEqual(sampler["inputs"]["latent_image"], ["latent", 0])

    def test_krea2_identity_denoise_scales_reference_hole_not_final_blend(self):
        self.use_krea2_identity_model()
        self.inputs["denoise"] = 0.3
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"canvas_width":768,"canvas_height":768}'
            ),
            **self.inputs,
        )
        nodes = list(result["expand"].values())
        sampler = next(node for node in nodes if node["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["denoise"], 1.0)
        mask_composite = next(
            node for node in nodes if node["class_type"] == "MaskComposite"
        )
        solid_id = mask_composite["inputs"]["source"][0]
        solid = result["expand"][solid_id]
        self.assertEqual(solid["class_type"], "SolidMask")
        self.assertEqual(solid["inputs"]["value"], 0.3)
        reference_composite = next(
            node for node in nodes
            if node["class_type"] == "ImageCompositeMasked"
            and result["expand"][node["inputs"]["source"][0]]["class_type"]
            == "EmptyImage"
        )
        self.assertEqual(
            reference_composite["inputs"]["mask"],
            [next(
                node_id for node_id, node in result["expand"].items()
                if node is mask_composite
            ), 0],
        )
        final_composite = next(
            node for node in nodes
            if node["class_type"] == "ImageCompositeMasked"
            and node is not reference_composite
        )
        final_mask_id = final_composite["inputs"]["mask"][0]
        self.assertEqual(
            result["expand"][final_mask_id]["class_type"],
            "LoadImageMask",
        )

    def test_krea2_identity_outpaint_uses_canvas_reference_and_clean_grounding(self):
        self.use_krea2_identity_model()
        self.inputs["positive"] = ["12", 0]
        self.inputs["prompt"]["12"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["9", 0],
                "text": "continue the same scene",
            },
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"outpaint_active":true,"canvas_width":1024,"canvas_height":1024,'
                '"image_transform":{"x":128,"y":64,"width":768,"height":768}}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        patch_id, patch = next(
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "NO8DKrea2ReferenceModel"
        )
        base_load_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImage"
            and node["inputs"]["image"] == "base.png"
        )
        source_latent_id = patch["inputs"]["source_latent"][0]
        self.assertEqual(
            expanded[source_latent_id]["inputs"]["pixels"],
            [base_load_id, 0],
        )
        self.assertEqual(patch["inputs"]["ref_boost"], 1.0)
        self.assertNotIn("vae", patch["inputs"])
        self.assertNotIn("source_image", patch["inputs"])
        grounded = [
            node for node in expanded.values()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        ]
        self.assertEqual(len(grounded), 1)
        source_load_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImage"
            and node["inputs"]["image"] == "source.png"
        )
        self.assertEqual(grounded[0]["inputs"]["image"], [source_load_id, 0])
        sampler = next(
            node for node in expanded.values()
            if node["class_type"] == "KSampler"
        )
        self.assertEqual(sampler["inputs"]["model"], [patch_id, 0])
        masked_id = sampler["inputs"]["latent_image"][0]
        self.assertEqual(expanded[masked_id]["class_type"], "SetLatentNoiseMask")
        target_id = expanded[masked_id]["inputs"]["samples"][0]
        self.assertEqual(expanded[target_id]["class_type"], "VAEEncode")
        self.assertFalse(any(
            node["class_type"] == "ImageCompositeMasked"
            for node in expanded.values()
        ))

    def test_krea2_identity_inpaint_masks_current_canvas_source_reference(self):
        self.use_krea2_identity_model()
        self.inputs["positive"] = ["12", 0]
        self.inputs["prompt"]["12"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["9", 0], "text": "original scene"},
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"canvas_width":1024,"canvas_height":1024}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        base_load_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImage"
            and node["inputs"]["image"] == "base.png"
        )
        source_load_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImage"
            and node["inputs"]["image"] == "source.png"
        )
        patch = next(
            node for node in expanded.values()
            if node["class_type"] == "NO8DKrea2ReferenceModel"
        )
        source_latent_id = patch["inputs"]["source_latent"][0]
        masked_reference_id = expanded[source_latent_id]["inputs"]["pixels"][0]
        masked_reference = expanded[masked_reference_id]
        self.assertEqual(masked_reference["class_type"], "ImageCompositeMasked")
        self.assertEqual(
            masked_reference["inputs"]["destination"],
            [base_load_id, 0],
        )
        empty_id = masked_reference["inputs"]["source"][0]
        self.assertEqual(expanded[empty_id]["class_type"], "EmptyImage")
        self.assertNotIn("source_image", patch["inputs"])
        self.assertEqual(patch["inputs"]["ref_boost"], 1.0)
        grounded = next(
            node for node in expanded.values()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        )
        self.assertEqual(grounded["inputs"]["image"], [source_load_id, 0])
        sampler = next(
            node for node in expanded.values()
            if node["class_type"] == "KSampler"
        )
        target_id = sampler["inputs"]["latent_image"][0]
        self.assertEqual(expanded[target_id]["class_type"], "EmptySD3LatentImage")

    def test_krea2_identity_inpaint_does_not_restate_the_original_t2i_prompt(self):
        self.use_krea2_identity_model()
        original_prompt = "a cat holding a need support sign"
        self.inputs["positive"] = ["12", 0]
        self.inputs["prompt"]["12"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["9", 0], "text": original_prompt},
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"canvas_width":1024,"canvas_height":1024}'
            ),
            **self.inputs,
        )
        grounded = next(
            node for node in result["expand"].values()
            if node["class_type"] == "NO8DKrea2GroundedEncode"
        )
        self.assertEqual(grounded["inputs"]["text"], "")
        self.assertNotIn(original_prompt, grounded["inputs"]["text"])

    def test_inactive_saved_mask_does_not_trigger_inpaint(self):
        classes = self.expand_classes(
            '{"base_image_file":"base.png","mask_image_file":"mask.png",'
            '"mask_active":false}'
        )
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("DifferentialDiffusion", classes)

    def test_active_mask_uses_native_inpaint_nodes(self):
        classes = self.expand_classes(
            '{"base_image_file":"base.png","mask_image_file":"mask.png",'
            '"mask_active":true}'
        )
        self.assertEqual(
            classes,
            [
                "ConditioningZeroOut",
                "LoadImage",
                "LoadImageMask",
                "DifferentialDiffusion",
                "VAEEncode",
                "ThresholdMask",
                "VAEEncodeForInpaint",
                "LatentBlend",
                "SetLatentNoiseMask",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "ImageScale",
                "ImageCompositeMasked",
                "PreviewImage",
            ],
        )

    def test_manual_inpaint_crop_includes_feather_and_context(self):
        crop = self.node._manual_inpaint_crop_geometry(
            {
                "strokes": [{
                    "op": "add",
                    "kind": "brush",
                    "brushSize": 80,
                    "points": [[500, 400]],
                }],
            },
            1024,
            768,
            50,
        )
        self.assertEqual(crop, {"x": 376, "y": 272, "width": 248, "height": 256})
        self.assertEqual(self.node._sampling_dimensions(248, 256), (512, 528))
        self.assertEqual(self.node._sampling_dimensions(200, 2000), (152, 1536))

    def test_generic_manual_inpaint_crops_samples_and_stitches_once(self):
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"canvas_width":1024,"canvas_height":768,'
                '"strokes":[{"op":"add","kind":"brush","brushSize":80,'
                '"points":[[500,400]]}]}'
            ),
            **self.inputs,
        )
        nodes = list(result["expand"].values())
        classes = [node["class_type"] for node in nodes]
        self.assertEqual(classes.count("ImageCrop"), 2)
        self.assertIn("MaskToImage", classes)
        self.assertIn("ImageToMask", classes)
        self.assertEqual(classes.count("KSampler"), 1)
        self.assertEqual(classes.count("ImageCompositeMasked"), 1)
        self.assertIn("VAEEncodeForInpaint", classes)
        self.assertIn("LatentBlend", classes)
        self.assertNotIn("ConditioningMultiply", classes)
        scales = [node for node in nodes if node["class_type"] == "ImageScale"]
        self.assertEqual(len(scales), 4)
        self.assertEqual(
            [(node["inputs"]["width"], node["inputs"]["height"]) for node in scales],
            [(512, 528), (512, 528), (512, 528), (248, 256)],
        )
        crop = next(node for node in nodes if node["class_type"] == "ImageCrop")
        self.assertEqual(
            crop["inputs"],
            {"image": ["2", 0], "width": 248, "height": 256, "x": 376, "y": 272},
        )
        composite = next(
            node for node in nodes if node["class_type"] == "ImageCompositeMasked"
        )
        cropped_mask_id = next(
            node_id for node_id, node in result["expand"].items()
            if node["class_type"] == "ImageToMask"
        )
        self.assertEqual(composite["inputs"]["mask"], [cropped_mask_id, 0])
        latent_mask = next(
            node for node in nodes if node["class_type"] == "SetLatentNoiseMask"
        )
        sampling_mask_id = latent_mask["inputs"]["mask"][0]
        self.assertEqual(
            result["expand"][sampling_mask_id]["class_type"], "ImageToMask",
        )
        self.assertFalse(any(
            node["class_type"] == "ThresholdMask"
            and node["inputs"]["value"] == 0.001
            for node in nodes
        ))

    def test_klein_manual_inpaint_reference_matches_crop_geometry(self):
        self.use_klein_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"canvas_width":1024,"canvas_height":768,'
                '"strokes":[{"op":"add","kind":"lasso","brushSize":80,'
                '"points":[[440,340],[560,340],[560,460],[440,460]]}]}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        classes = [node["class_type"] for node in nodes]
        self.assertEqual(classes.count("VAEEncode"), 1)
        self.assertEqual(classes.count("ReferenceLatent"), 2)
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("LatentBlend", classes)
        encodes = [
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "VAEEncode"
        ]
        references = [
            node for node in nodes if node["class_type"] == "ReferenceLatent"
        ]
        self.assertTrue(all(
            node["inputs"]["latent"] == [encodes[0][0], 0]
            for node in references
        ))

    def test_klein_inpaint_uses_native_reference_latent_conditioning(self):
        self.use_klein_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        classes = [node["class_type"] for node in nodes]

        self.assertEqual(classes.count("ReferenceLatent"), 2)
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("LatentBlend", classes)
        encode_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "VAEEncode"
        )
        masked = next(
            node for node in nodes if node["class_type"] == "SetLatentNoiseMask"
        )
        self.assertEqual(masked["inputs"]["samples"], [encode_id, 0])
        references = [
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "ReferenceLatent"
        ]
        self.assertTrue(all(node["inputs"]["latent"] == [encode_id, 0] for _, node in references))
        sampler = next(node for node in nodes if node["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["positive"], [references[0][0], 0])
        self.assertEqual(sampler["inputs"]["negative"], [references[1][0], 0])

    def test_klein_outpaint_keeps_full_edit_conditioning(self):
        self.use_klein_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":1536,"canvas_height":1024}'
            ),
            **self.inputs,
        )
        classes = [node["class_type"] for node in result["expand"].values()]
        self.assertEqual(classes.count("ReferenceLatent"), 2)
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("ConditioningMultiply", classes)
        self.assertNotIn("ConditioningSetMask", classes)
        self.assertNotIn("ConditioningCombine", classes)

    def test_klein_outpaint_reference_uses_composited_canvas_geometry(self):
        self.use_klein_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","source_image_file":"source.png",'
                '"mask_image_file":"mask.png","mask_active":true,'
                '"outpaint_active":true,"canvas_width":1536,"canvas_height":1024}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        loads = [node for node in nodes if node["class_type"] == "LoadImage"]
        self.assertEqual([node["inputs"]["image"] for node in loads], ["base.png"])
        encodes = [
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "VAEEncode"
        ]
        self.assertEqual(len(encodes), 1)
        self.assertEqual(encodes[0][1]["inputs"]["pixels"], ["2", 0])
        references = [
            node for node in nodes if node["class_type"] == "ReferenceLatent"
        ]
        self.assertTrue(all(
            node["inputs"]["latent"] == [encodes[0][0], 0]
            for node in references
        ))
        masked = next(
            node for node in nodes if node["class_type"] == "SetLatentNoiseMask"
        )
        self.assertEqual(masked["inputs"]["samples"], [encodes[0][0], 0])

    def test_klein_multi_side_outpaint_uses_one_coherent_reference_pass(self):
        self.use_klein_model()
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":768,"canvas_height":1152,"strokes":[],'
                '"image_transform":{"x":-59.5,"y":231.7,'
                '"width":692.9,"height":692.9}}'
            ),
            **self.inputs,
        )
        classes = [node["class_type"] for node in result["expand"].values()]
        self.assertEqual(classes.count("KSampler"), 1)
        self.assertEqual(classes.count("VAEEncode"), 1)
        self.assertEqual(classes.count("ReferenceLatent"), 2)
        self.assertNotIn("VAEEncodeForInpaint", classes)
        self.assertNotIn("ConditioningMultiply", classes)

    def test_klein_detection_follows_model_loader_chain_only(self):
        prompt = {
            "20": {
                "class_type": "LoraLoader",
                "inputs": {"model": ["10", 0], "lora_name": "portrait.safetensors"},
            },
            "10": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": "flux-2-klein-base-9b.safetensors"},
            },
            "30": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "a klein bottle"},
            },
        }
        self.assertTrue(self.node._uses_flux2_klein_reference(prompt, ["20", 0]))
        self.assertFalse(self.node._uses_flux2_klein_reference(prompt, ["30", 0]))

    def test_outpaint_uses_cleared_native_inpaint_latent_without_blending_black_canvas(self):
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":1536,"canvas_height":1024}'
            ),
            **self.inputs,
        )
        nodes = list(result["expand"].values())
        classes = [node["class_type"] for node in nodes]
        self.assertNotIn("VAEEncode", classes)
        self.assertNotIn("LatentBlend", classes)
        self.assertIn("VAEEncodeForInpaint", classes)
        self.assertIn("ConditioningMultiply", classes)
        self.assertEqual(classes.count("ConditioningSetMask"), 2)
        self.assertIn("ConditioningCombine", classes)
        inpaint_id, _ = next(
            (node_id, node) for node_id, node in result["expand"].items()
            if node["class_type"] == "VAEEncodeForInpaint"
        )
        masked = next(node for node in nodes if node["class_type"] == "SetLatentNoiseMask")
        self.assertEqual(masked["inputs"]["samples"], [inpaint_id, 0])

    def test_multi_axis_outpaint_uses_one_native_canvas_pass(self):
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":768,"canvas_height":1152,"strokes":[],'
                '"image_transform":{"x":-59.5,"y":231.7,'
                '"width":692.9,"height":692.9}}'
            ),
            **self.inputs,
        )
        nodes = list(result["expand"].values())
        classes = [node["class_type"] for node in nodes]
        self.assertEqual(classes.count("KSampler"), 1)
        self.assertEqual(classes.count("VAEEncodeForInpaint"), 1)
        self.assertEqual(classes.count("ConditioningMultiply"), 1)
        self.assertEqual(classes.count("ConditioningSetMask"), 2)
        self.assertEqual(classes.count("ConditioningCombine"), 1)
        self.assertNotIn("ImageCrop", classes)
        self.assertNotIn("SolidMask", classes)
        self.assertNotIn("FeatherMask", classes)
        self.assertNotIn("MaskComposite", classes)
        sampler = next(node for node in nodes if node["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["seed"], 1)
        load_mask_id = next(
            node_id for node_id, node in result["expand"].items()
            if node["class_type"] == "LoadImageMask"
        )
        composites = [
            node for node in result["expand"].values()
            if node["class_type"] == "ImageCompositeMasked"
        ]
        self.assertEqual(len(composites), 1)
        self.assertEqual(composites[0]["inputs"]["mask"], [load_mask_id, 0])
        self.assertFalse(composites[0]["inputs"]["resize_source"])
        latent_masks = [
            node["inputs"]["mask"] for node in nodes
            if node["class_type"] == "SetLatentNoiseMask"
        ]
        self.assertEqual(len(latent_masks), 1)
        self.assertEqual(latent_masks[0], [load_mask_id, 0])
        self.assertFalse(any(
            node["class_type"] == "ThresholdMask"
            and node["inputs"]["value"] == 0.001
            for node in nodes
        ))

    def test_opposite_side_outpaint_still_uses_one_canvas_pass(self):
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"outpaint_active":true,'
                '"canvas_width":960,"canvas_height":768,"strokes":[],'
                '"image_transform":{"x":192,"y":0,"width":576,"height":768}}'
            ),
            **self.inputs,
        )
        classes = [node["class_type"] for node in result["expand"].values()]
        self.assertEqual(classes.count("KSampler"), 1)
        self.assertEqual(classes.count("ImageCrop"), 0)

    def test_mask_overlay_remains_visible_after_outpaint_result(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "if (this.isMaskModeActive()) this.drawMask(ctx);",
            source,
        )
        self.assertNotIn(
            "if (this.isMaskModeActive() && !resultMatchesCanvas)",
            source,
        )

    def test_finished_outpaint_becomes_the_next_editing_base(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("promoteOutpaintResultToEditingBase()", source)
        self.assertIn(
            "if (this.transformActive && this.outpaintResultVisible)",
            source,
        )
        self.assertIn(
            "this.promoteOutpaintResultToEditingBase();",
            source,
        )
        self.assertIn(
            '&& ["transform", "lasso", "brush", "eraser"].includes(action)',
            source,
        )
        self.assertIn(
            "beginTransformDrag(pos) {\n"
            "        if (!this.transformActive || !this.contentRect) return false;\n"
            "        if (this.outpaintResultVisible) {\n"
            "            this.promoteOutpaintResultToEditingBase();",
            source,
        )
        self.assertIn('if (action !== "transform") this.outpaintResultVisible = false;', source)
        self.assertIn("this.sourceImage = result;", source)
        self.assertIn("width: this.canvasWidth,", source)
        self.assertIn("height: this.canvasHeight,", source)

    def test_outpaint_feather_is_bounded_by_canvas_instead_of_image_radius(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("OUTPAINT_FEATHER_MAX_CANVAS_FRACTION = 0.1", source)
        self.assertIn("sourceShortSide * 0.15", source)
        self.assertIn("MASK_RENDER_VERSION = 2", source)
        self.assertIn("state.mask_render_version", source)
        self.assertNotIn(
            "this.getFeatherWidth(Math.min(transform.width, transform.height) / 2)",
            source,
        )
        self.assertIn(
            "const feather = this.outpaintFeatherWidth(transform);",
            source,
        )
        self.assertIn(
            "? 1 + feather * 2 / sourceShortSide",
            source,
        )

    def test_outpaint_execution_mask_avoids_full_canvas_pixel_loops(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertNotIn("ctx.createImageData(width, height)", source)
        self.assertIn(
            "step <= EXECUTION_MASK_GRADIENT_STEPS",
            source,
        )

    def test_outpaint_ratio_is_collapsed_into_the_transform_tool_options(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("Number.isFinite(restoredShortSide)", source)
        self.assertIn(
            "this.latentShortSide = Math.min(width, height);",
            source,
        )
        self.assertNotIn("canvas_short_side", source)
        self.assertNotIn("SHORT_SIDE_PRESETS", source)
        self.assertNotIn("`${this.canvasWidth} × ${this.canvasHeight}`", source)
        self.assertNotIn("OUTPAINT_TOOLBAR_HEIGHT", source)
        self.assertNotIn("drawOutpaintToolbar", source)
        self.assertNotIn("outpaintToolbarRect", source)
        self.assertIn("if (this.transformActive) {", source)
        self.assertIn('"canvas_ratio",', source)
        self.assertIn(
            'this.buttons.push({ action: "canvas_swap", rect, enabled: true });',
            source,
        )
        self.assertIn("this.rect[3] - TOOLBAR_HEIGHT,", source)

    def test_brush_and_eraser_buttons_are_hidden_but_legacy_state_is_supported(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'const visibleToolActions = ["transform", "lasso"];',
            source,
        )
        self.assertNotIn(
            'for (const action of ["transform", "lasso", "brush", "eraser"])',
            source,
        )
        self.assertIn(
            'if (action === "brush" || action === "lasso" || action === "eraser")',
            source,
        )

    def test_canvas_tools_are_disabled_until_an_image_is_available(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "const editingImageAvailable = Boolean(this.editingImage()?.naturalWidth);",
            source,
        )
        self.assertIn("const enabled = editingImageAvailable;", source)
        self.assertNotIn(
            'const enabled = action !== "transform"',
            source,
        )

    def test_outpaint_requires_the_transform_tool_to_be_active(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "return this.transformActive && this.hasOutpaintArea();",
            source,
        )
        self.assertIn("outpaint_active: this.isOutpaintModeActive()", source)
        self.assertIn(
            "return this.isMaskToolActive() && this.hasMaskContent();",
            source,
        )
        self.assertIn(
            "return this.isInpaintModeActive() || this.isOutpaintModeActive();",
            source,
        )

    def test_inpaint_and_outpaint_tools_are_mutually_exclusive(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("clearInpaintMode() {", source)
        self.assertIn("clearOutpaintMode() {", source)
        self.assertIn("if (activating) this.clearInpaintMode();", source)
        self.assertIn(
            'if (action === "brush" || action === "lasso" || action === "eraser") {\n'
            "            this.closeActiveEditor();\n"
            "            this.clearOutpaintMode();",
            source,
        )
        self.assertIn(
            "const hadModeConflict = this.transformActive && this.hasMaskContent();",
            source,
        )
        self.assertIn("this.strokes = [];", source)
        self.assertIn("this.invert = false;", source)

    def test_transform_edges_and_corners_expose_directional_cursors(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn('nw: "nwse-resize"', source)
        self.assertIn('ne: "nesw-resize"', source)
        self.assertIn('n: "ns-resize"', source)
        self.assertIn('e: "ew-resize"', source)
        self.assertIn('move: dragging ? "grabbing" : "grab"', source)
        self.assertIn("const hit = this.transformHit(pos);", source)
        self.assertIn('style.setProperty("cursor", cursor, "important")', source)
        self.assertIn("requestAnimationFrame(applyCursor)", source)
        self.assertIn("nodeType.prototype.onMouseMove = function", source)
        self.assertIn("widget?.updateHover?.(pos)", source)
        self.assertIn("nodeType.prototype.onMouseLeave = function", source)

    def test_canvas_widget_yields_native_node_resize_corners(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("isNodeResizeCorner(pos)", source)
        self.assertIn("widget?.isNodeResizeCorner?.(pos)", source)
        self.assertIn("widget.releaseTransformCursor?.()", source)
        self.assertIn(
            "!this.transformDrag && !this.activeStroke && this.isNodeResizeCorner(nodePos)",
            source,
        )
        self.assertIn("return originalOnMouseMove?.apply(this, arguments);", source)
        self.assertIn("const NODE_RESIZE_CORNER_SIZE = 24;", source)
        self.assertIn("nodeType.prototype.findResizeDirection = function", source)
        self.assertIn(
            "rect.findContainingCorner(x, y, NODE_RESIZE_CORNER_SIZE)",
            source,
        )

    def test_transform_controls_are_clipped_to_the_node_canvas(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("visibleTransformRect()", source)
        self.assertIn("ctx.rect(...this.canvasRect.slice(0, 4));", source)
        self.assertIn(
            "if (!this.transformActive || !pointInRect(pos, this.canvasRect)) return null;",
            source,
        )
        self.assertIn("const deltaX = pointer[0] - drag.pointer[0];", source)

    def test_canvas_ratio_preview_preserves_the_existing_image_aspect_ratio(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("this.image.naturalWidth,", source)
        self.assertIn("this.image.naturalHeight,", source)
        self.assertIn("ctx.drawImage(this.previewImage || this.image, ...this.contentRect);", source)

    def test_frontend_accepts_internal_preview_from_node_callback_and_event(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("async function applyGeneratePreview(node, message)", source)
        self.assertIn("applyGeneratePreview(this, arguments[0])", source)
        self.assertIn(
            "applyGeneratePreview(node, detail?.output || detail)",
            source,
        )

    def test_canvas_dimensions_do_not_resize_initial_latent_output(self):
        result = self.node.expand(
            canvas='{"canvas_width":2720,"canvas_height":1536}',
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        classes = [node["class_type"] for node in nodes]
        self.assertEqual(
            classes,
            [
                "ConditioningZeroOut",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "PreviewImage",
            ],
        )
        sampler = next(node for node in nodes if node["class_type"] == "KSampler")
        self.assertEqual(sampler["inputs"]["latent_image"], ["latent", 0])

    def test_inpaint_blends_original_and_cleared_latents_by_denoise(self):
        self.inputs["denoise"] = 1.0
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        threshold = next(node for node in nodes if node["class_type"] == "ThresholdMask")
        inpaint = next(node for node in nodes if node["class_type"] == "VAEEncodeForInpaint")
        blend_id, blend = next(
            (node_id, node) for node_id, node in expanded.items()
            if node["class_type"] == "LatentBlend"
        )
        masked = next(node for node in nodes if node["class_type"] == "SetLatentNoiseMask")
        self.assertEqual(threshold["inputs"]["value"], 0.99)
        self.assertEqual(inpaint["inputs"]["grow_mask_by"], 6)
        self.assertAlmostEqual(blend["inputs"]["blend_factor"], 0.0)
        self.assertEqual(masked["inputs"]["samples"], [blend_id, 0])
        loaded_mask_id = next(
            node_id for node_id, node in expanded.items()
            if node["class_type"] == "LoadImageMask"
        )
        self.assertEqual(masked["inputs"]["mask"], [loaded_mask_id, 0])

        self.inputs["denoise"] = 0.5
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true}'
            ),
            **self.inputs,
        )
        blend = next(
            node for node in result["expand"].values()
            if node["class_type"] == "LatentBlend"
        )
        self.assertAlmostEqual(blend["inputs"]["blend_factor"], 0.5)

    def test_frontend_syncs_canvas_to_initial_latent_result_size(self):
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn("syncCanvasToImageSize(image)", source)
        self.assertIn("this.canvasWidth = width;", source)
        self.assertIn("this.canvasHeight = height;", source)
        self.assertIn("this.syncCanvasToImageSize(image);", source)

    def test_node_schema_has_latent_input_and_no_image_input(self):
        inputs = self.node.INPUT_TYPES()
        self.assertIn("latent", inputs["required"])
        self.assertNotIn("image", inputs.get("optional", {}))
        source = (
            pathlib.Path(__file__).resolve().parents[1] / "web" / "generate.js"
        ).read_text(encoding="utf-8")
        self.assertIn('node.inputs[index]?.name !== "image"', source)
        self.assertNotIn('node.inputs[index]?.name !== "latent"', source)

    def test_active_mask_requires_uploaded_files(self):
        with self.assertRaisesRegex(RuntimeError, "mask upload"):
            self.node.expand(canvas='{"mask_active":true}', **self.inputs)

    def test_packed_rgb_is_normalized_before_native_preview(self):
        import torch

        packed = torch.zeros((1, 2, 3, 12))
        normalized = GENERATE.NO8DNormalizeDecodedImage.normalize(packed)[0]
        self.assertEqual(tuple(normalized.shape), (1, 4, 6, 3))

    def test_standard_rgb_passes_through_without_copy(self):
        import torch

        image = torch.zeros((1, 2, 3, 3))
        self.assertIs(GENERATE.NO8DNormalizeDecodedImage.normalize(image)[0], image)

    def test_downstream_output_keeps_generate_owned_internal_preview(self):
        self.inputs["prompt"] = {
            "2": {
                "class_type": "PreviewImage",
                "inputs": {"images": ["1", 0]},
            }
        }
        self.assertEqual(
            self.expand_classes("{}"),
            [
                "ConditioningZeroOut",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "PreviewImage",
            ],
        )


if __name__ == "__main__":
    unittest.main()

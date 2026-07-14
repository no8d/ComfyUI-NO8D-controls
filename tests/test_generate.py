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
                "VAEEncode",
                "ThresholdMask",
                "VAEEncodeForInpaint",
                "LatentBlend",
                "SetLatentNoiseMask",
                "DifferentialDiffusion",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "ImageCompositeMasked",
                "PreviewImage",
            ],
        )

    def test_large_canvas_is_scaled_to_input_latent_size_with_native_nodes(self):
        import torch

        self.inputs["latent"] = {
            "samples": torch.zeros((1, 16, 96, 170)),
            "downscale_ratio_spacial": 8,
        }
        result = self.node.expand(
            canvas=(
                '{"base_image_file":"base.png","mask_image_file":"mask.png",'
                '"mask_active":true,"mask_base_width":2720,"mask_base_height":1536}'
            ),
            **self.inputs,
        )
        expanded = result["expand"]
        nodes = list(expanded.values())
        classes = [node["class_type"] for node in nodes]
        self.assertEqual(
            classes,
            [
                "ConditioningZeroOut",
                "LoadImage",
                "LoadImageMask",
                "ImageScale",
                "MaskToImage",
                "ImageScale",
                "ImageToMask",
                "VAEEncode",
                "ThresholdMask",
                "VAEEncodeForInpaint",
                "LatentBlend",
                "SetLatentNoiseMask",
                "DifferentialDiffusion",
                "KSampler",
                "VAEDecode",
                "NO8DNormalizeDecodedImage",
                "ImageCompositeMasked",
                "PreviewImage",
            ],
        )
        scale_nodes = [node for node in nodes if node["class_type"] == "ImageScale"]
        self.assertEqual(
            [(node["inputs"]["width"], node["inputs"]["height"]) for node in scale_nodes],
            [(1360, 768), (1360, 768)],
        )
        self.assertEqual(scale_nodes[0]["inputs"]["upscale_method"], "lanczos")
        self.assertEqual(scale_nodes[1]["inputs"]["upscale_method"], "bilinear")

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
        self.assertAlmostEqual(blend["inputs"]["blend_factor"], 0.3)
        self.assertEqual(masked["inputs"]["samples"], [blend_id, 0])

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
        self.assertAlmostEqual(blend["inputs"]["blend_factor"], 0.65)

    def test_matching_canvas_and_latent_size_skip_resize_nodes(self):
        import torch

        self.inputs["latent"] = {
            "samples": torch.zeros((1, 16, 96, 170)),
            "downscale_ratio_spacial": 8,
        }
        classes = self.expand_classes(
            '{"base_image_file":"base.png","mask_image_file":"mask.png",'
            '"mask_active":true,"mask_base_width":1360,"mask_base_height":768}'
        )
        self.assertNotIn("ImageScale", classes)
        self.assertNotIn("MaskToImage", classes)
        self.assertNotIn("ImageToMask", classes)

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

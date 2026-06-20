import nodes as comfy_nodes


class NO8DABPreview:
    def __init__(self):
        self._last_images = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "NO8D-control"

    def preview(self, images, prompt=None, extra_pnginfo=None):
        saver = comfy_nodes.PreviewImage()
        ui = saver.save_images(
            images,
            filename_prefix="NO8DABPreview",
        )
        current_images = ui["ui"]["images"]
        previous_images = self._last_images or current_images
        self._last_images = current_images
        return {"ui": {"a_images": current_images, "b_images": previous_images}}


NODE_CLASS_MAPPINGS = {"NO8DABPreview": NO8DABPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DABPreview": "NO8D-A/B preview"}

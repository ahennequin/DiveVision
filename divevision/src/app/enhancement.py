"""The single place the app turns an uploaded photo into an Enhanced Image.

The arq worker loads the model once (`load_model`) and calls `enhance_image`
for every job. Model imports stay inside `load_model` so the API process,
which imports `MODEL_NAME` from here, never pulls in PyTorch or loads weights.
"""

import io
from typing import TYPE_CHECKING

from PIL import Image, ImageOps

if TYPE_CHECKING:
    from divevision.src.models.abstract_model import AbstractModel

# Must match `UShapeModelWrapper.name`; model choice is out of scope for now.
MODEL_NAME = "U-Shape"

ENHANCED_CONTENT_TYPE = "image/png"


def load_model() -> "AbstractModel":
    """Load the Enhancement Model the app serves (import registers and loads it)."""
    from divevision.src.models import AbstractModel

    return AbstractModel.get_model(MODEL_NAME)


def enhance_image(model: "AbstractModel", original: bytes) -> bytes:
    """Run `model` on an uploaded photo's bytes and return the Enhanced Image as PNG."""
    with Image.open(io.BytesIO(original)) as image:
        # Phone photos are often stored sideways with an EXIF orientation tag,
        # and PNGs may carry an alpha channel the 3-channel model rejects.
        degraded = ImageOps.exif_transpose(image).convert("RGB")

    enhanced: Image.Image = model.predict(degraded)[0]  # predict() returns a list

    buffer = io.BytesIO()
    enhanced.save(buffer, "PNG")
    return buffer.getvalue()

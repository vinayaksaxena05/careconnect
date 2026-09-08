"""Dataset loaders.

``synthetic`` builds a reproducible stand-in dataset so the whole pipeline can
run without access to MIMIC-IV-ED. ``mimic`` extracts the real training frame
from a local MIMIC-IV-ED download (never committed - see data/README.md).
"""

from ml.data.synthetic import generate_synthetic_dataset

__all__ = ["generate_synthetic_dataset"]

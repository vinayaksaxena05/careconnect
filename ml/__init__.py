"""CareConnect ML subsystem.

Offline concerns (training, evaluation, preprocessing definition) and the
runtime inference abstraction used by the FastAPI backend all live here.

Nothing in this package talks to the database or the web layer. The backend
consumes only :mod:`ml.inference`.
"""

__all__ = ["__version__"]

__version__ = "1.0.0"

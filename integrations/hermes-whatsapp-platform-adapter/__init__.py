try:
    from .whatsapp_manager import register
except ImportError:
    from whatsapp_manager import register

__all__ = ["register"]

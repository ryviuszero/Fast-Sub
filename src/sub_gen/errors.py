class SubGenError(RuntimeError):
    """Base error for user-facing CLI failures."""


class ProviderLimitError(SubGenError):
    """Raised when a provider rejects an upload because of size or duration limits."""


class ProviderResponseError(SubGenError):
    """Raised when a provider returns an unsupported response shape."""

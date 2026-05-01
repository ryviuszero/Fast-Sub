class SubGenError(RuntimeError):
    """Base error for user-facing CLI failures."""


class ProviderLimitError(SubGenError):
    """Raised when a provider rejects an upload because of size or duration limits."""


class ProviderResponseError(SubGenError):
    """Raised when a provider returns an unsupported response shape."""


class WorkerRunnerError(SubGenError):
    """Raised when a local worker process cannot complete its contract."""

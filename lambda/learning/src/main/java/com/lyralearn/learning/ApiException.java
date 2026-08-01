package com.lyralearn.learning;

/** Maps service-level failures to HTTP status + JSON error body. */
public class ApiException extends RuntimeException {
    private final int status;

    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() { return status; }
}

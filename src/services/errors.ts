/** Shared error type for the service layer; errorHandler maps it to HTTP. */
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
  }
}

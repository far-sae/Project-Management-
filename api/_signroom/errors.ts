/** An error whose message is safe to show the user; status is the HTTP status. */
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** A database or storage failure. The text goes to the server log only. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

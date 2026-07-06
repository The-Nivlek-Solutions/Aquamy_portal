// lib/action-utils.ts
// Utility for server actions — ensures error messages survive Next.js
// production error sanitization.
//
// Next.js strips thrown error messages in production for security.
// This wrapper encodes the message into the error so it survives.
//
// Usage in server actions:
//   throw actionError("Phone number already in use.");
//
// Usage in client components (catch block):
//   catch (err) {
//     setError(parseActionError(err));
//   }

export function actionError(message: string): Error {
  // Prefix makes it identifiable on the client side
  return new Error(`ACTION_ERROR:${message}`);
}

export function parseActionError(err: unknown): string {
  if (err instanceof Error) {
    // Strip the prefix if present
    if (err.message.startsWith("ACTION_ERROR:")) {
      return err.message.replace("ACTION_ERROR:", "");
    }
    // Next.js production sanitized message
    if (
      err.message.includes("An error occurred") ||
      err.message.includes("error content has been hidden") ||
      err.message.includes("NEXT_HTTP_ERROR_FALLBACK")
    ) {
      return "Something went wrong. Please try again or contact support.";
    }
    return err.message;
  }
  return "An unexpected error occurred.";
}
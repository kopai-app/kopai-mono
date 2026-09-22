import type {
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/server";

/**
 * A validator provider that accepts everything, so that the tool handler is
 * what validates.
 *
 * Three reasons, and each would be sufficient on its own:
 *
 * 1. Correctness. The `query` schema is a union of six branches. The SDK's
 *    default validator rejects before dispatch and answers with one text line
 *    listing every branch's failures, which tells a model nothing about which
 *    field it got wrong. The handler instead selects the one branch the
 *    caller's `signal`/`mode` names and reports issues against it.
 * 2. Cost. The default provider is AJV-backed and compiles the schema it is
 *    given. The transport builds a fresh server per request, so that
 *    compilation would happen on every call.
 * 3. Observability. A rejection made before dispatch never reaches the
 *    handler, so it never reaches `onToolCall` — the counter would undercount
 *    exactly the failures most worth seeing.
 *
 * NOTE the shape: `fromJsonSchema`'s second argument is a provider object with
 * a `getValidator` method, not a validator function. Passing a bare function
 * throws `TypeError: validator.getValidator is not a function`, which the SDK
 * swallows into a 500 on `initialize` — presenting as "the whole server is
 * broken" rather than as a bad argument.
 */
export const passThroughValidator: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input: unknown) => ({
      valid: true,
      data: input as T,
      errorMessage: undefined,
    });
  },
};

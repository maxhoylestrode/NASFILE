import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { BadRequestError } from './errors';

type Source = 'body' | 'params' | 'query';

/**
 * Parses req[source] against a zod schema. On success, req[source] is
 * replaced with the parsed (and coerced/defaulted) value. On failure,
 * forwards a 400 with a compact list of field errors — never the raw
 * zod error object, to avoid leaking schema internals.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new BadRequestError(`Validation failed: ${JSON.stringify(details)}`));
      return;
    }
    req[source] = result.data;
    next();
  };
}

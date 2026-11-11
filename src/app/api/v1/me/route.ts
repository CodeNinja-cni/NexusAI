import { resolveRequestPrincipal } from "@/modules/auth/server/session";
import { prisma } from "@/platform/database/prisma";
import {
  MalformedJsonError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
  getRequestId,
  isTrustedMutationRequest,
  readJsonBody
} from "@/platform/http/request";
import {
  internalProblemResponse,
  problemResponse,
  validationProblem
} from "@/platform/http/problem";
import { profileUpdateSchema } from "@/shared/validation/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class StaleProfileError extends Error {}

function userEtag(userId: string, version: number) {
  return `"user:${userId}:${version}"`;
}

function profileData(principal: NonNullable<Awaited<ReturnType<typeof resolveRequestPrincipal>>>) {
  return {
    id: principal.user.id,
    name: principal.user.name,
    email: principal.user.email,
    emailVerified: principal.user.emailVerified,
    image: principal.user.image,
    platformRole: principal.user.platformRole,
    status: principal.user.status,
    version: principal.user.version,
    provisioning: principal.provisioning
  };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const principal = await resolveRequestPrincipal(request.headers);

  if (!principal) {
    return problemResponse({
      status: 401,
      code: "unauthenticated",
      title: "Authentication required",
      detail: "A valid session is required.",
      instance: "/api/v1/me",
      requestId
    });
  }

  return Response.json(
    { data: profileData(principal), meta: { requestId } },
    {
      headers: {
        "Cache-Control": "private, no-store",
        ETag: userEtag(principal.user.id, principal.user.version),
        "X-Request-Id": requestId
      }
    }
  );
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  const instance = "/api/v1/me";

  if (!isTrustedMutationRequest(request)) {
    return problemResponse({
      status: 403,
      code: "untrusted_origin",
      title: "Request origin rejected",
      detail: "This state-changing request did not come from a trusted origin.",
      instance,
      requestId
    });
  }

  const principal = await resolveRequestPrincipal(request.headers);
  if (!principal) {
    return problemResponse({
      status: 401,
      code: "unauthenticated",
      title: "Authentication required",
      detail: "A valid session is required.",
      instance,
      requestId
    });
  }

  const expectedEtag = userEtag(principal.user.id, principal.user.version);
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch) {
    return problemResponse({
      status: 428,
      code: "precondition_required",
      title: "Precondition required",
      detail: "Provide the current profile ETag in If-Match.",
      instance,
      requestId
    });
  }
  if (ifMatch !== expectedEtag) {
    return problemResponse({
      status: 412,
      code: "stale_version",
      title: "Profile changed",
      detail: "Reload the profile before applying this change.",
      instance,
      requestId,
      headers: { ETag: expectedEtag }
    });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return problemResponse({
        status: 415,
        code: "unsupported_media_type",
        title: "Unsupported media type",
        detail: "Use application/json.",
        instance,
        requestId
      });
    }
    if (error instanceof RequestBodyTooLargeError) {
      return problemResponse({
        status: 413,
        code: "request_too_large",
        title: "Request body too large",
        detail: "The JSON body must not exceed 256 KiB.",
        instance,
        requestId
      });
    }
    if (error instanceof MalformedJsonError) {
      return problemResponse({
        status: 400,
        code: "malformed_json",
        title: "Malformed JSON",
        detail: "The request body is not valid JSON.",
        instance,
        requestId
      });
    }
    return internalProblemResponse(instance, requestId, "profile-api");
  }

  const parsedBody = profileUpdateSchema.safeParse(body);
  if (!parsedBody.success) return validationProblem(parsedBody.error, instance, requestId);

  let updatedUser: { id: string; name: string; image: string | null; version: number };
  try {
    updatedUser = await prisma.$transaction(async (transaction) => {
      const result = await transaction.user.updateMany({
        where: {
          id: principal.user.id,
          version: principal.user.version,
          status: "ACTIVE",
          deletedAt: null
        },
        data: {
          ...(parsedBody.data.name !== undefined ? { name: parsedBody.data.name } : {}),
          ...(parsedBody.data.image !== undefined ? { image: parsedBody.data.image } : {}),
          version: { increment: 1 }
        }
      });

      if (result.count !== 1) throw new StaleProfileError();

      const user = await transaction.user.findUniqueOrThrow({
        where: { id: principal.user.id },
        select: { id: true, name: true, image: true, version: true }
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: principal.user.id,
          actorKind: "USER",
          action: "profile.updated",
          targetType: "user",
          targetId: principal.user.id,
          outcome: "SUCCEEDED",
          requestId,
          changes: {
            fields: Object.keys(parsedBody.data)
          }
        }
      });

      return user;
    });
  } catch (error) {
    if (error instanceof StaleProfileError) {
      return problemResponse({
        status: 412,
        code: "stale_version",
        title: "Profile changed",
        detail: "Reload the profile before applying this change.",
        instance,
        requestId
      });
    }
    return internalProblemResponse(instance, requestId, "profile-api");
  }

  return Response.json(
    {
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        image: updatedUser.image,
        version: updatedUser.version
      },
      meta: { requestId }
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        ETag: userEtag(updatedUser.id, updatedUser.version),
        "X-Request-Id": requestId
      }
    }
  );
}

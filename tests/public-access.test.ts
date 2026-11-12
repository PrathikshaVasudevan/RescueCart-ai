import assert from "node:assert/strict";
import test from "node:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../proxy";

test("homepage and store are outside the authentication proxy matcher", () => {
  for (const url of ["https://rescuecart.test/", "https://rescuecart.test/store"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, `${url} must not invoke authentication proxy`);
  }
});

test("Recovery Centre page and APIs pass through without a Basic Auth challenge", () => {
  for (const pathname of ["/recovery", "/api/recovery/payments", "/api/recovery/actions", "/api/recovery/analyze"]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `https://rescuecart.test${pathname}` }),
      true,
      `${pathname} remains covered by the proxy route matcher`,
    );

    const response = proxy({} as Parameters<typeof proxy>[0]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("www-authenticate"), false);
  }
});

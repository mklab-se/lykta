import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Header } from "../../src/web/components/Header.tsx";

test("warnings are shown", () => {
  const html = renderToString(
    <Header
      entries={[]}
      now={0}
      staleMinutes={null}
      warnings={["GitHub rate limit for acme: data delayed until 13:00"]}
    />,
  );
  expect(html).toContain("GitHub rate limit for acme");
});

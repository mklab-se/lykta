import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Header } from "../../src/web/components/Header.tsx";
import { MonitoredBand } from "../../src/web/components/MonitoredBand.tsx";

const plan = { height: 600, unit: "big" as const, columns: 4, rows: 2, pages: 1 };

test("connecting screen before first sync", () => {
  const html = renderToString(
    <MonitoredBand
      entries={[]}
      plan={plan}
      page={0}
      now={0}
      onOpen={() => {}}
      allEmpty
      connecting
    />,
  );
  expect(html).toContain("Connecting to GitHub");
  expect(html).not.toContain("Nothing is monitored yet");
});

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

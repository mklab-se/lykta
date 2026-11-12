/**
 * The spotlight (spec section 3.2): one workflow opens as a large diagram over the track for a
 * few seconds while the track behind it blurs. The pit is never covered.
 */
import { motion } from "motion/react";
import type { EntryView } from "../../core/types.ts";
import { FinishedCard, RunningCard } from "./RunCard.tsx";

export function Spotlight(props: {
  e: EntryView;
  /** A finished run's last turn rather than a running one. */
  final: boolean;
  width: number;
  height: number;
  now: number;
  onOpen: (key: string) => void;
}) {
  const { e } = props;
  const running = !props.final && e.state === "running" && e.current;
  const finished = !running && e.latestCompleted;
  if (!running && !finished) return null;
  return (
    <motion.div
      className="spotlight"
      data-entry={e.key}
      style={{ width: props.width, height: props.height }}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.5 } }}
      transition={{ duration: 0.6, ease: [0.2, 0.9, 0.2, 1] }}
      onClick={() => props.onOpen(e.key)}
    >
      {running ? (
        <RunningCard e={e} width={props.width} height={props.height} now={props.now} />
      ) : (
        <FinishedCard e={e} width={props.width} />
      )}
    </motion.div>
  );
}

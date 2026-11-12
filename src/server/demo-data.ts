/**
 * Example pipelines, runners, names and failure logs for demo mode. Shaped like
 * Kristofer's reality: long Android builds, matrices, ARC and lab runners.
 * Lykta only knows jobs, steps and logs, so nothing here pretends to know tests.
 */
import type { RunnerInfo } from "../core/types.ts";

export interface JobTemplate {
  id: string;
  name: string;
  needs: string[];
  steps: string[];
  /** Relative step lengths; defaults to equal. */
  weights?: number[];
  minutes: number;
  group?: string;
  runner: RunnerInfo;
}

export type PipelineName = "small" | "medium" | "android";

const gh = (label: string): RunnerInfo => ({ kind: "gh", label });
const k8s = (label: string, detail: string): RunnerInfo => ({ kind: "k8s", label, detail });
const lab = (label: string, detail: string): RunnerInfo => ({ kind: "lab", label, detail });

export function pipeline(name: PipelineName, pick: <T>(xs: T[]) => T): JobTemplate[] {
  if (name === "small") {
    return [
      {
        id: "check",
        name: "Check",
        needs: [],
        steps: ["Checkout", "Typecheck", "Lint"],
        minutes: 1.5,
        runner: gh("ubuntu-latest"),
      },
      {
        id: "assemble",
        name: "Assemble",
        needs: [],
        steps: ["Checkout", "Install", "Assemble"],
        minutes: 2,
        runner: k8s("arc-runners", pick(["k8s-node-02", "k8s-node-05", "k8s-node-07"])),
      },
      {
        id: "package",
        name: "Package",
        needs: ["check", "assemble"],
        steps: ["Build image", "Push"],
        minutes: 1,
        runner: k8s("arc-runners", "k8s-node-01"),
      },
    ];
  }
  if (name === "medium") {
    return [
      {
        id: "lint",
        name: "Lint",
        needs: [],
        steps: ["Checkout", "Setup Bun", "Biome"],
        minutes: 1,
        runner: gh("ubuntu-latest"),
      },
      {
        id: "b-linux",
        name: "Build · linux",
        needs: ["lint"],
        steps: ["Checkout", "Install", "Compile", "Upload"],
        minutes: 4,
        runner: gh("ubuntu-latest"),
      },
      {
        id: "b-mac",
        name: "Build · macos",
        needs: ["lint"],
        steps: ["Checkout", "Install", "Compile", "Sign"],
        minutes: 5,
        runner: gh("macos-15"),
      },
      {
        id: "b-win",
        name: "Build · windows",
        needs: ["lint"],
        steps: ["Checkout", "Install", "Compile"],
        minutes: 6,
        runner: gh("windows-latest"),
      },
      {
        id: "integration",
        name: "Integration",
        needs: ["b-linux", "b-mac", "b-win"],
        steps: ["Start services", "Run suite", "Report"],
        minutes: 4,
        runner: k8s("arc-runners", pick(["k8s-node-03", "k8s-node-06"])),
      },
      {
        id: "deploy",
        name: "Deploy staging",
        needs: ["integration"],
        steps: ["Login", "Helm upgrade", "Verify rollout"],
        minutes: 2,
        runner: k8s("arc-runners", "k8s-node-01"),
      },
    ];
  }
  const targets = [
    "aosp_cf_x86_64-userdebug",
    "lynx-userdebug",
    "lynx-user",
    "tangorpro-userdebug",
  ];
  const devices: [string, string][] = [
    ["lab-bench-2", "Pixel 9"],
    ["lab-bench-3", "Pixel Tablet"],
    ["lab-bench-4", "Zebra TC58"],
    ["lab-bench-5", "Rugged R11"],
  ];
  return [
    {
      id: "mirror",
      name: "Update mirror",
      needs: [],
      steps: ["Set up job", "Fetch manifest", "repo sync mirror"],
      weights: [1, 1, 8],
      minutes: 12,
      runner: k8s("arc-aosp-64core", "k8s-build-01"),
    },
    {
      id: "lint",
      name: "Lint & checkstyle",
      needs: ["mirror"],
      steps: ["Checkout", "Run lint"],
      weights: [1, 4],
      minutes: 8,
      runner: gh("ubuntu-latest"),
    },
    ...targets.map((t, i) => ({
      id: `build-${t}`,
      name: `Build · ${t}`,
      needs: ["mirror"],
      steps: [
        "Set up job",
        "Free disk space",
        "repo sync -j16",
        "envsetup && lunch",
        "m -j64",
        "Package images",
        "Upload artifacts",
        "Complete job",
      ],
      weights: [1, 1, 6, 1, 60, 4, 3, 1],
      minutes: 260 + i * 15,
      group: "Build",
      runner: k8s("arc-aosp-64core", `k8s-build-0${2 + i}`),
    })),
    {
      id: "sign",
      name: "Sign images",
      needs: targets.map((t) => `build-${t}`),
      steps: ["Download images", "Sign", "Verify signatures"],
      weights: [2, 3, 1],
      minutes: 14,
      runner: k8s("arc-runners", "k8s-node-04"),
    },
    ...devices.map(([bench, device]) => ({
      id: `flash-${bench}`,
      name: `Flash & boot · ${device}`,
      needs: ["sign"],
      steps: ["Reserve bench", "fastboot flash", "Wait for boot", "Smoke checks", "Collect logcat"],
      weights: [1, 3, 3, 4, 1],
      minutes: 22,
      group: "Flash & boot",
      runner: lab(bench, device),
    })),
    {
      id: "publish",
      name: "Publish OTA",
      needs: devices.map(([b]) => `flash-${b}`),
      steps: ["Build OTA package", "Upload", "Notify"],
      weights: [4, 2, 1],
      minutes: 18,
      runner: k8s("arc-runners", "k8s-node-01"),
    },
  ];
}

export const FAIL_LOGS: Record<"android" | "device" | "app" | "generic", string[]> = {
  android: [
    "[ 87% 118342/136011] //frameworks/base:framework-minus-apex javac",
    "FAILED: out/soong/.intermediates/frameworks/base/framework-minus-apex",
    "frameworks/base/core/java/android/os/Battery.java:212: error: cannot find symbol",
    "ninja: build stopped: subcommand failed.",
    "#### failed to build some targets (4:38:51 (hh:mm:ss)) ####",
  ],
  device: [
    "Sending 'super' (4194304 KB)   OKAY [ 91.2s]",
    "Rebooting into bootloader      OKAY",
    "Waiting for device to boot ... timeout after 600 s",
    "adb: device 'lab-bench-2' not found",
    "Error: device did not become ready",
  ],
  app: [
    "> Task :app:compileReleaseKotlin",
    "e: src/main/kotlin/Sync.kt:88:17 Unresolved reference: retryPolicy",
    "> Task :app:compileReleaseKotlin FAILED",
    "BUILD FAILED in 4m 12s",
    "Error: Process completed with exit code 1.",
  ],
  generic: [
    "Run ./scripts/deploy.sh staging",
    "helm upgrade --install api ./chart --wait --timeout 5m",
    "Error: UPGRADE FAILED: timed out waiting for the condition",
    "Error: Process completed with exit code 1.",
  ],
};

export function failLogFor(jobName: string): string[] {
  if (/Flash & boot/.test(jobName)) return FAIL_LOGS.device;
  if (/Build · .*(aosp|lynx|tangor)/.test(jobName)) return FAIL_LOGS.android;
  if (/Build|Check|Assemble|Lint/.test(jobName)) return FAIL_LOGS.app;
  return FAIL_LOGS.generic;
}

export interface EntryTemplate {
  repo: string;
  workflow: string;
  name: string;
  pipeline: PipelineName;
  seed?: "failed" | "running" | "never" | "missing";
}

/** The first entries tell a story; the rest are generated. */
export const STORY: EntryTemplate[] = [
  {
    repo: "mklab-se/android-platform",
    workflow: "nightly.yml",
    name: "Nightly build",
    pipeline: "android",
    seed: "failed",
  },
  {
    repo: "mklab-se/field-app",
    workflow: "release.yml",
    name: "Release",
    pipeline: "medium",
    seed: "failed",
  },
  {
    repo: "mklab-se/android-platform",
    workflow: "build.yml",
    name: "Android build",
    pipeline: "android",
    seed: "running",
  },
  {
    repo: "mklab-se/pidge",
    workflow: "release.yml",
    name: "Release",
    pipeline: "medium",
    seed: "running",
  },
  {
    repo: "mklab-se/mklab.se",
    workflow: "publish.yml",
    name: "Publish",
    pipeline: "small",
    seed: "never",
  },
  {
    repo: "acme-corp/billing",
    workflow: "nightly.yml",
    name: "Nightly",
    pipeline: "small",
    seed: "missing",
  },
];

export const REPOS = [
  "ailloy",
  "cosq",
  "rigg",
  "honk",
  "skiss",
  "mdeck",
  "deemer",
  "infra",
  "gateway",
  "inventory",
  "warehouse",
  "analytics",
  "notifier",
  "payments",
  "docs",
  "design-system",
  "scheduler",
  "ledger",
  "media",
  "reports",
  "auth",
  "search",
  "firmware",
  "android-devices",
];
export const NAMES = [
  "CI",
  "Release",
  "Deploy",
  "Nightly",
  "Docs",
  "Terraform plan",
  "Security scan",
  "Publish",
  "Benchmarks",
];
export const ORGS = ["mklab-se", "acme-corp", "northwind"];
export const ACTORS = ["kristofer", "anna", "jonas", "dependabot"];

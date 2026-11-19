import { describe, expect, test, beforeEach } from "bun:test";
import { parseNvidiaSmiOutput, resetGpuCache, type GpuStats } from "../src/gpu";

describe("GPU monitoring", () => {
  beforeEach(() => {
    resetGpuCache();
  });

  describe("parseNvidiaSmiOutput", () => {
    test("parses valid nvidia-smi output with all fields", () => {
      const output = "NVIDIA GeForce RTX 4070 SUPER, 45, 52, 2048, 12282, 150.00, 2100, 7501\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).toEqual({
        name: "NVIDIA GeForce RTX 4070 SUPER",
        loadPercent: 45,
        tempC: 52,
        memUsedMB: 2048,
        memTotalMB: 12282,
        powerW: 150.0,
        clockMHz: 2100,
        memClockMHz: 7501,
      });
    });

    test("parses output with [Not Supported] fields", () => {
      const output = "GeForce GTX 1060, 30, 65, 1024, 6144, [Not Supported], [Not Supported], [Not Supported]\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).toEqual({
        name: "GeForce GTX 1060",
        loadPercent: 30,
        tempC: 65,
        memUsedMB: 1024,
        memTotalMB: 6144,
        powerW: null,
        clockMHz: null,
        memClockMHz: null,
      });
    });

    test("handles minimal valid output", () => {
      const output = "GPU, 50, 70, 100, 200\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.loadPercent).toBe(50);
      expect(result!.tempC).toBe(70);
    });

    test("clamps load percentage to 0-100", () => {
      const output = "GPU, 150, 70, 100, 200\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.loadPercent).toBe(100);
    });

    test("handles negative values as 0", () => {
      const output = "GPU, -10, 70, -50, 200\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.loadPercent).toBe(0);
      expect(result!.memUsedMB).toBe(0);
    });

    test("returns null for empty output", () => {
      expect(parseNvidiaSmiOutput("")).toBeNull();
      expect(parseNvidiaSmiOutput("\n")).toBeNull();
      expect(parseNvidiaSmiOutput("   \n   ")).toBeNull();
    });

    test("returns null for invalid output with too few fields", () => {
      expect(parseNvidiaSmiOutput("GPU, 50, 70")).toBeNull();
      expect(parseNvidiaSmiOutput("GPU, 50")).toBeNull();
    });

    test("returns null for non-numeric load/temp", () => {
      expect(parseNvidiaSmiOutput("GPU, abc, 70, 100, 200")).toBeNull();
      expect(parseNvidiaSmiOutput("GPU, 50, def, 100, 200")).toBeNull();
    });

    test("handles multi-line output (takes first line)", () => {
      const output = "GPU1, 30, 50, 100, 200\nGPU2, 60, 70, 150, 300\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("GPU1");
      expect(result!.loadPercent).toBe(30);
    });

    test("handles floating point power values", () => {
      const output = "GPU, 45, 52, 2048, 12282, 149.75, 2100, 7501\n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.powerW).toBeCloseTo(149.75, 2);
    });

    test("handles whitespace in fields", () => {
      const output = " GPU ,  45 ,  52 ,  2048 ,  12282 \n";
      const result = parseNvidiaSmiOutput(output);
      expect(result).not.toBeNull();
      expect(result!.loadPercent).toBe(45);
    });
  });

  describe("GpuStats interface", () => {
    test("stats object has all required fields", () => {
      const stats: GpuStats = {
        name: "Test GPU",
        loadPercent: 50,
        tempC: 60,
        memUsedMB: 1000,
        memTotalMB: 8000,
        powerW: 150,
        clockMHz: 1800,
        memClockMHz: 7000,
      };
      expect(stats.name).toBe("Test GPU");
      expect(stats.loadPercent).toBe(50);
      expect(stats.tempC).toBe(60);
      expect(stats.memUsedMB).toBe(1000);
      expect(stats.memTotalMB).toBe(8000);
      expect(stats.powerW).toBe(150);
      expect(stats.clockMHz).toBe(1800);
      expect(stats.memClockMHz).toBe(7000);
    });

    test("nullable fields can be null", () => {
      const stats: GpuStats = {
        name: "Test GPU",
        loadPercent: 50,
        tempC: 60,
        memUsedMB: 1000,
        memTotalMB: 8000,
        powerW: null,
        clockMHz: null,
        memClockMHz: null,
      };
      expect(stats.powerW).toBeNull();
      expect(stats.clockMHz).toBeNull();
      expect(stats.memClockMHz).toBeNull();
    });
  });
});

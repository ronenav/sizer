import {
  calculateNodeOverCommit,
  calculateClusterOverCommit,
} from "../../src/utils/common";
import { Node, Service } from "../../src/types";

describe("Over-Commit Calculation Functions", () => {
  describe("calculateNodeOverCommit", () => {
    it("should calculate correct over-commit ratio with limits", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 16,
        memory: 64,
        machineSet: "worker",
        services: [1, 2],
        onlyFor: [],
      };

      const services: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 1, // Request: 1 CPU
          requiredMemory: 4, // Request: 4 GB
          limitCPU: 4, // Limit: 4 CPU (4:1 over-commit)
          limitMemory: 16, // Limit: 16 GB (4:1 over-commit)
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "VM-2",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 4,
          limitMemory: 16,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Requests should sum correctly
      expect(result.requestedCPU).toBe(3);
      expect(result.requestedMemory).toBe(12);

      // Limits should sum correctly
      expect(result.limitCPU).toBe(8);
      expect(result.limitMemory).toBe(32);

      // Over-commit ratio should be calculated against allocatable (after Kubelet)
      // Node: 16 CPU, 64 GB
      // Kubelet reserves ~0.11 CPU, ~5.23 GB
      // Allocatable: ~15.89 CPU, ~58.77 GB
      // Over-commit ratio: 8 / 15.89 ≈ 0.503 (no over-commit)
      expect(result.cpuOverCommitRatio).toBeGreaterThan(0.5);
      expect(result.cpuOverCommitRatio).toBeLessThan(0.6);

      // Risk level should be "none" since ratio < 1
      expect(result.riskLevel).toBe("none");
    });

    it("should handle no over-commit (limits = requests)", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 8,
        memory: 32,
        machineSet: "worker",
        services: [1],
        onlyFor: [],
      };

      const services: Service[] = [
        {
          id: 1,
          name: "Pod-1",
          requiredCPU: 2,
          requiredMemory: 8,
          // No limits specified - should default to requests
          zones: 1,
          runsWith: [],
          avoid: [],
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // With no limits, they should equal requests
      expect(result.requestedCPU).toBe(result.limitCPU);
      expect(result.requestedMemory).toBe(result.limitMemory);

      // Over-commit ratio should be based on request == limit
      expect(result.cpuOverCommitRatio).toBeLessThan(1);
      expect(result.riskLevel).toBe("none");
    });

    it("should calculate risk level correctly", () => {
      // Test low risk (1 < ratio <= 2)
      const lowRiskNode: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 8,
        memory: 32,
        machineSet: "worker",
        services: [1],
        onlyFor: [],
      };

      const lowRiskServices: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 14, // Will result in ~1.8:1 ratio
          limitMemory: 28,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
      ];

      const lowRiskResult = calculateNodeOverCommit(
        lowRiskNode,
        lowRiskServices
      );
      expect(lowRiskResult.riskLevel).toBe("low");

      // Test medium risk (2 < ratio <= 4)
      const mediumRiskServices: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 22, // Will result in ~2.8:1 ratio
          limitMemory: 45,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
      ];

      const mediumRiskResult = calculateNodeOverCommit(
        lowRiskNode,
        mediumRiskServices
      );
      expect(mediumRiskResult.riskLevel).toBe("medium");

      // Test high risk (ratio > 4)
      const highRiskServices: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 36, // Will result in ~4.6:1 ratio
          limitMemory: 72,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
      ];

      const highRiskResult = calculateNodeOverCommit(
        lowRiskNode,
        highRiskServices
      );
      expect(highRiskResult.riskLevel).toBe("high");
    });

    it("should handle mixed services (some with over-commit, some without)", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 16,
        memory: 64,
        machineSet: "worker",
        services: [1, 2, 3],
        onlyFor: [],
      };

      const services: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 1,
          requiredMemory: 4,
          limitCPU: 4,
          limitMemory: 16,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "Regular-Pod",
          requiredCPU: 2,
          requiredMemory: 8,
          // No limits - will use requests
          zones: 1,
          runsWith: [],
          avoid: [],
        },
        {
          id: 3,
          name: "VM-2",
          requiredCPU: 1,
          requiredMemory: 4,
          limitCPU: 2,
          limitMemory: 8,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Requests: 1 + 2 + 1 = 4
      expect(result.requestedCPU).toBe(4);
      expect(result.requestedMemory).toBe(16);

      // Limits: 4 + 2 (falls back to request) + 2 = 8
      expect(result.limitCPU).toBe(8);
      expect(result.limitMemory).toBe(32);
    });
  });

  describe("calculateClusterOverCommit", () => {
    it("should calculate correct cluster-wide over-commit", () => {
      const nodes: Node[] = [
        {
          id: 1,
          maxDisks: 24,
          cpuUnits: 16,
          memory: 64,
          machineSet: "worker",
          services: [1, 2],
          onlyFor: [],
        },
        {
          id: 2,
          maxDisks: 24,
          cpuUnits: 16,
          memory: 64,
          machineSet: "worker",
          services: [3],
          onlyFor: [],
        },
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 1,
          requiredMemory: 4,
          limitCPU: 4,
          limitMemory: 16,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "VM-2",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 4,
          limitMemory: 16,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 3,
          name: "VM-3",
          requiredCPU: 1,
          requiredMemory: 4,
          limitCPU: 2,
          limitMemory: 8,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Total requests
      expect(result.totalRequests.cpu).toBe(4);
      expect(result.totalRequests.memory).toBe(16);

      // Total limits
      expect(result.totalLimits.cpu).toBe(10);
      expect(result.totalLimits.memory).toBe(40);

      // Total allocatable (2 nodes, each with 16 CPU / 64 GB, minus Kubelet)
      // Each node: ~15.89 CPU, ~58.77 GB allocatable
      // Total: ~31.78 CPU, ~117.54 GB
      expect(result.totalAllocatable.cpu).toBeGreaterThan(31);
      expect(result.totalAllocatable.cpu).toBeLessThan(32);
      expect(result.totalAllocatable.memory).toBeGreaterThan(117);
      expect(result.totalAllocatable.memory).toBeLessThan(118);

      // Over-commit ratio: 10 / 31.78 ≈ 0.31 (no over-commit at cluster level)
      expect(result.overCommitRatio.cpu).toBeLessThan(1);
      expect(result.riskLevel).toBe("none");
    });

    it("should handle cluster with high over-commit", () => {
      const nodes: Node[] = [
        {
          id: 1,
          maxDisks: 24,
          cpuUnits: 8,
          memory: 32,
          machineSet: "worker",
          services: [1, 2],
          onlyFor: [],
        },
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "VM-1",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 16,
          limitMemory: 64,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "VM-2",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 16,
          limitMemory: 64,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Total limits: 32 CPU, 128 GB
      // Allocatable: ~7.96 CPU, ~30.23 GB
      // Ratio: 32 / 7.96 ≈ 4.02 (high over-commit)
      expect(result.overCommitRatio.cpu).toBeGreaterThan(4);
      expect(result.riskLevel).toBe("high");
    });

    it("should handle cluster with no over-commit", () => {
      const nodes: Node[] = [
        {
          id: 1,
          maxDisks: 24,
          cpuUnits: 16,
          memory: 64,
          machineSet: "worker",
          services: [1],
          onlyFor: [],
        },
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "Regular-Pod",
          requiredCPU: 2,
          requiredMemory: 8,
          // No limits - defaults to requests
          zones: 1,
          runsWith: [],
          avoid: [],
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      expect(result.totalRequests.cpu).toBe(result.totalLimits.cpu);
      expect(result.totalRequests.memory).toBe(result.totalLimits.memory);
      expect(result.riskLevel).toBe("none");
    });
  });
});

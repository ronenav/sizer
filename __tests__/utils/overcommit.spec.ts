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
          overCommitMode: "static",
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

    it("should handle dynamic over-commit with min/max ranges", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 16,
        memory: 64,
        machineSet: "worker",
        services: [1],
        onlyFor: [],
      };

      const services: Service[] = [
        {
          id: 1,
          name: "VM-Dynamic",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 4,
          maxLimitCPU: 8,
          minLimitMemory: 16,
          maxLimitMemory: 32,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Requests should be as defined
      expect(result.requestedCPU).toBe(2);
      expect(result.requestedMemory).toBe(8);

      // Limits should be ranges
      expect(typeof result.limitCPU).toBe("object");
      expect(typeof result.limitMemory).toBe("object");
      expect((result.limitCPU as any).min).toBe(4);
      expect((result.limitCPU as any).max).toBe(8);
      expect((result.limitMemory as any).min).toBe(16);
      expect((result.limitMemory as any).max).toBe(32);

      // Over-commit ratios should be ranges
      expect(typeof result.cpuOverCommitRatio).toBe("object");
      expect(typeof result.memoryOverCommitRatio).toBe("object");

      // Risk level should be based on max ratio
      // Node: 16 CPU, 64 GB → Allocatable: ~15.89 CPU, ~58.77 GB
      // Max ratio: 8 / 15.89 ≈ 0.50 (none) or 32 / 58.77 ≈ 0.54 (none)
      expect(result.riskLevel).toBe("none");
    });

    it("should handle mixed static and dynamic services", () => {
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
          name: "VM-Static",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 8,
          limitMemory: 32,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "VM-Dynamic",
          requiredCPU: 1,
          requiredMemory: 4,
          minLimitCPU: 2,
          maxLimitCPU: 6,
          minLimitMemory: 8,
          maxLimitMemory: 24,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Requests: 2 + 1 = 3
      expect(result.requestedCPU).toBe(3);
      expect(result.requestedMemory).toBe(12);

      // Limits should be ranges (presence of dynamic service)
      expect(typeof result.limitCPU).toBe("object");
      expect(typeof result.limitMemory).toBe("object");

      // Min limits: 8 + 2 = 10
      // Max limits: 8 + 6 = 14
      expect((result.limitCPU as any).min).toBe(10);
      expect((result.limitCPU as any).max).toBe(14);
      expect((result.limitMemory as any).min).toBe(40);
      expect((result.limitMemory as any).max).toBe(56);

      // Over-commit ratios should be ranges
      expect(typeof result.cpuOverCommitRatio).toBe("object");
      expect(typeof result.memoryOverCommitRatio).toBe("object");
    });

    it("should calculate high risk for dynamic over-commit with large max", () => {
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
          name: "VM-High-Risk",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 8,
          maxLimitCPU: 40,
          minLimitMemory: 16,
          maxLimitMemory: 80,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Node: 8 CPU, 32 GB → Allocatable: ~7.96 CPU, ~30.23 GB
      // Max CPU ratio: 40 / 7.96 ≈ 5.03 (high)
      // Max Memory ratio: 80 / 30.23 ≈ 2.65 (medium)
      // Risk level should be "high" (based on worst-case)
      expect(result.riskLevel).toBe("high");
    });

    it("should fallback to static limits for dynamic mode missing min/max", () => {
      const node: Node = {
        id: 1,
        maxDisks: 24,
        cpuUnits: 16,
        memory: 64,
        machineSet: "worker",
        services: [1],
        onlyFor: [],
      };

      const services: Service[] = [
        {
          id: 1,
          name: "VM-Partial-Dynamic",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 8,
          limitMemory: 32,
          // No min/max specified - should use limitCPU/limitMemory
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateNodeOverCommit(node, services);

      // Should fall back to static limits
      expect(result.limitCPU).toBe(8);
      expect(result.limitMemory).toBe(32);
      expect(typeof result.cpuOverCommitRatio).toBe("number");
      expect(typeof result.memoryOverCommitRatio).toBe("number");
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

    it("should handle cluster with dynamic over-commit", () => {
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
        {
          id: 2,
          maxDisks: 24,
          cpuUnits: 16,
          memory: 64,
          machineSet: "worker",
          services: [2],
          onlyFor: [],
        },
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "VM-Dynamic-1",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 4,
          maxLimitCPU: 12,
          minLimitMemory: 16,
          maxLimitMemory: 48,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
        {
          id: 2,
          name: "VM-Dynamic-2",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 4,
          maxLimitCPU: 12,
          minLimitMemory: 16,
          maxLimitMemory: 48,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Total requests: 2 + 2 = 4
      expect(result.totalRequests.cpu).toBe(4);
      expect(result.totalRequests.memory).toBe(16);

      // Total limits should be ranges
      expect(typeof result.totalLimits.cpu).toBe("object");
      expect(typeof result.totalLimits.memory).toBe("object");
      expect((result.totalLimits.cpu as any).min).toBe(8);
      expect((result.totalLimits.cpu as any).max).toBe(24);
      expect((result.totalLimits.memory as any).min).toBe(32);
      expect((result.totalLimits.memory as any).max).toBe(96);

      // Over-commit ratios should be ranges
      expect(typeof result.overCommitRatio.cpu).toBe("object");
      expect(typeof result.overCommitRatio.memory).toBe("object");
    });

    it("should handle cluster with mixed static and dynamic over-commit", () => {
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
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "VM-Static",
          requiredCPU: 2,
          requiredMemory: 8,
          limitCPU: 8,
          limitMemory: 32,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "static",
        },
        {
          id: 2,
          name: "VM-Dynamic",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 4,
          maxLimitCPU: 16,
          minLimitMemory: 16,
          maxLimitMemory: 64,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Total requests: 2 + 2 = 4
      expect(result.totalRequests.cpu).toBe(4);
      expect(result.totalRequests.memory).toBe(16);

      // Total limits should be ranges (due to dynamic service)
      expect(typeof result.totalLimits.cpu).toBe("object");
      expect(typeof result.totalLimits.memory).toBe("object");

      // Min limits: 8 + 4 = 12
      // Max limits: 8 + 16 = 24
      expect((result.totalLimits.cpu as any).min).toBe(12);
      expect((result.totalLimits.cpu as any).max).toBe(24);
      expect((result.totalLimits.memory as any).min).toBe(48);
      expect((result.totalLimits.memory as any).max).toBe(96);
    });

    it("should handle cluster with multi-zone dynamic services", () => {
      const nodes: Node[] = [
        {
          id: 1,
          maxDisks: 24,
          cpuUnits: 8,
          memory: 32,
          machineSet: "worker",
          services: [1, 1, 1], // Service 1 placed 3 times (3 zones)
          onlyFor: [],
        },
        {
          id: 2,
          maxDisks: 24,
          cpuUnits: 8,
          memory: 32,
          machineSet: "worker",
          services: [],
          onlyFor: [],
        },
        {
          id: 3,
          maxDisks: 24,
          cpuUnits: 8,
          memory: 32,
          machineSet: "worker",
          services: [],
          onlyFor: [],
        },
      ];

      const services: Service[] = [
        {
          id: 1,
          name: "VM-Multi-Zone",
          requiredCPU: 1,
          requiredMemory: 4,
          minLimitCPU: 2,
          maxLimitCPU: 6,
          minLimitMemory: 8,
          maxLimitMemory: 24,
          zones: 3, // Replicated across 3 zones
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Total requests: 1 * 3 = 3
      expect(result.totalRequests.cpu).toBe(3);
      expect(result.totalRequests.memory).toBe(12);

      // Total limits should be ranges (multiplied by zones)
      expect(typeof result.totalLimits.cpu).toBe("object");
      expect(typeof result.totalLimits.memory).toBe("object");

      // Min limits: 2 * 3 = 6
      // Max limits: 6 * 3 = 18
      expect((result.totalLimits.cpu as any).min).toBe(6);
      expect((result.totalLimits.cpu as any).max).toBe(18);
      expect((result.totalLimits.memory as any).min).toBe(24);
      expect((result.totalLimits.memory as any).max).toBe(72);
    });

    it("should calculate correct risk level for dynamic cluster-wide over-commit", () => {
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
          minLimitCPU: 4,
          maxLimitCPU: 20,
          minLimitMemory: 16,
          maxLimitMemory: 60,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
        {
          id: 2,
          name: "VM-2",
          requiredCPU: 2,
          requiredMemory: 8,
          minLimitCPU: 4,
          maxLimitCPU: 20,
          minLimitMemory: 16,
          maxLimitMemory: 60,
          zones: 1,
          runsWith: [],
          avoid: [],
          overCommitMode: "dynamic",
        },
      ];

      const result = calculateClusterOverCommit(nodes, services);

      // Node: 8 CPU, 32 GB → Allocatable: ~7.96 CPU, ~30.23 GB
      // Max CPU ratio: 40 / 7.96 ≈ 5.03 (high)
      // Max Memory ratio: 120 / 30.23 ≈ 3.97 (medium)
      // Risk level should be "high" (based on worst-case)
      expect(result.riskLevel).toBe("high");
    });
  });
});

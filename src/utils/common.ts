import {
  Instance,
  MachineSet,
  Platform,
  Service,
  NodeOverCommitMetrics,
  ClusterOverCommitMetrics,
} from "../types";
import { Node } from "../types";
import {
  getNodeKubeletCPURequirements,
  getNodeKubeletMemoryRequirements,
} from "./kubelet";

type ResourceRequirement = {
  totalMem: number;
  totalCPU: number;
  totalDisks: number;
};

export const getTotalResourceRequirement = (
  services: Service[],
  multiplyByZone?: boolean
): ResourceRequirement => {
  return services.reduce(
    (acc, service) => {
      if (service.name.includes("Ceph_OSD")) {
        acc.totalDisks += 1;
      }
      acc.totalMem += multiplyByZone
        ? service.requiredMemory * service.zones
        : service.requiredMemory;
      acc.totalCPU += multiplyByZone
        ? service.requiredCPU * service.zones
        : service.requiredCPU;
      return acc;
    },
    { totalMem: 0, totalCPU: 0, totalDisks: 0 }
  );
};

export const canNodeSupportRequirements = (
  requirements: ResourceRequirement,
  currentUsage: ResourceRequirement,
  node: Node
): boolean => {
  const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
  const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);

  return requirements.totalCPU + currentUsage.totalCPU + kubeletCPU >
    node.cpuUnits ||
    requirements.totalMem + currentUsage.totalMem + kubeletMemory >
      node.memory ||
    requirements.totalDisks + currentUsage.totalDisks > node.maxDisks
    ? false
    : true;
};
export const isCloudPlatform = (platform: Platform): boolean =>
  [
    Platform.AWS,
    Platform.AZURE,
    Platform.GCP,
    Platform.IBMC,
    Platform.IBMV,
  ].includes(platform);

export const getMachinetSetFromInstance = (
  instance: Instance,
  id: number,
  name: string,
  label: string,
  onlyFor: string[] = [],
  maxDisks?: number
): MachineSet => {
  return {
    id,
    name,
    cpu: instance.cpuUnits,
    memory: instance.memory,
    instanceName: instance.name,
    numberOfDisks: maxDisks ?? instance.maxDisks,
    onlyFor,
    label,
  };
};

/**
 * Calculate over-commit metrics for a single node
 * @param node - The node to analyze
 * @param services - Services running on the node
 * @returns NodeOverCommitMetrics with requested/limit resources and ratios
 */
export const calculateNodeOverCommit = (
  node: Node,
  services: Service[]
): NodeOverCommitMetrics => {
  // Calculate Kubelet overhead
  const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
  const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);

  // Available capacity after Kubelet
  const availableCPU = node.cpuUnits - kubeletCPU;
  const availableMemory = node.memory - kubeletMemory;

  // Sum up requests and limits from services
  const requestedCPU = services.reduce(
    (sum, service) => sum + service.requiredCPU,
    0
  );
  const requestedMemory = services.reduce(
    (sum, service) => sum + service.requiredMemory,
    0
  );

  // For limits, use the limit value if present, otherwise fall back to request
  const limitCPU = services.reduce(
    (sum, service) => sum + (service.limitCPU ?? service.requiredCPU),
    0
  );
  const limitMemory = services.reduce(
    (sum, service) => sum + (service.limitMemory ?? service.requiredMemory),
    0
  );

  // Calculate over-commit ratios (limits / available capacity after Kubelet)
  const cpuOverCommitRatio = availableCPU > 0 ? limitCPU / availableCPU : 1;
  const memoryOverCommitRatio =
    availableMemory > 0 ? limitMemory / availableMemory : 1;

  // Determine risk level based on over-commit ratios
  const maxRatio = Math.max(cpuOverCommitRatio, memoryOverCommitRatio);
  let riskLevel: "none" | "low" | "medium" | "high";
  if (maxRatio <= 1) {
    riskLevel = "none";
  } else if (maxRatio <= 2) {
    riskLevel = "low";
  } else if (maxRatio <= 4) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  return {
    requestedCPU,
    requestedMemory,
    limitCPU,
    limitMemory,
    cpuOverCommitRatio,
    memoryOverCommitRatio,
    riskLevel,
  };
};

/**
 * Calculate over-commit metrics for the entire cluster
 * @param nodes - All nodes in the cluster
 * @param services - All services in the cluster
 * @returns ClusterOverCommitMetrics with cluster-wide over-commit info
 */
export const calculateClusterOverCommit = (
  nodes: Node[],
  services: Service[]
): ClusterOverCommitMetrics => {
  // Calculate total allocatable capacity (after Kubelet for all nodes)
  const totalAllocatable = nodes.reduce(
    (acc, node) => {
      const kubeletCPU = getNodeKubeletCPURequirements(node.cpuUnits);
      const kubeletMemory = getNodeKubeletMemoryRequirements(node.memory);
      return {
        cpu: acc.cpu + (node.cpuUnits - kubeletCPU),
        memory: acc.memory + (node.memory - kubeletMemory),
      };
    },
    { cpu: 0, memory: 0 }
  );

  // Calculate total requests and limits based on actual service placements on nodes
  // Count how many times each service is placed on nodes
  const servicePlacements = nodes.flatMap((node) => node.services);
  // Create a map to count placements per service ID
  const placementCounts = servicePlacements.reduce((acc, serviceId) => {
    acc[serviceId] = (acc[serviceId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // Calculate totals by multiplying each service's resources by its placement count
  const totalRequests = { cpu: 0, memory: 0 };
  const totalLimits = { cpu: 0, memory: 0 };

  services.forEach((service) => {
    const placementCount = placementCounts[service.id as number] || 0;
    totalRequests.cpu += service.requiredCPU * placementCount;
    totalRequests.memory += service.requiredMemory * placementCount;
    totalLimits.cpu +=
      (service.limitCPU ?? service.requiredCPU) * placementCount;
    totalLimits.memory +=
      (service.limitMemory ?? service.requiredMemory) * placementCount;
  });

  // Calculate over-commit ratios
  const overCommitRatio = {
    cpu: totalAllocatable.cpu > 0 ? totalLimits.cpu / totalAllocatable.cpu : 1,
    memory:
      totalAllocatable.memory > 0
        ? totalLimits.memory / totalAllocatable.memory
        : 1,
  };

  // Determine risk level
  const maxRatio = Math.max(overCommitRatio.cpu, overCommitRatio.memory);
  let riskLevel: "none" | "low" | "medium" | "high";
  if (maxRatio <= 1) {
    riskLevel = "none";
  } else if (maxRatio <= 2) {
    riskLevel = "low";
  } else if (maxRatio <= 4) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  return {
    totalRequests,
    totalLimits,
    totalAllocatable,
    overCommitRatio,
    riskLevel,
  };
};

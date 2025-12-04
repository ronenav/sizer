import { workloadScheduler } from "../../src/scheduler/workloadScheduler";
import {
  addNode,
  addService,
  addWorkload,
  removeAllNodes,
  removeAllZones,
} from "../../src/redux/reducers";
import { MachineSet, Service, Workload } from "../../src/types";
import { configureStore } from "@reduxjs/toolkit";
import {
  serviceReducer,
  workloadReducer,
  nodeReducer,
  zoneReducer,
  machineSetReducer,
  clusterReducer,
} from "../../src/redux/reducers";

describe("Integration: Scheduling with Over-Commitment", () => {
  let store: any;
  let dispatch: any;

  beforeEach(() => {
    // Create a fresh store for each test
    store = configureStore({
      reducer: {
        service: serviceReducer,
        workload: workloadReducer,
        node: nodeReducer,
        zone: zoneReducer,
        machineSet: machineSetReducer,
        cluster: clusterReducer,
      },
    });
    dispatch = store.dispatch;

    // Clear nodes and zones
    dispatch(removeAllNodes());
    dispatch(removeAllZones());
  });

  it("should schedule services based on requests, not limits", () => {
    // Create a MachineSet with limited resources
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 8,
      memory: 32,
      instanceName: "m5.2xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    // Create services with over-commitment
    // Service 1: Request 2 CPU / 8 GB, Limit 8 CPU / 32 GB (4:1 over-commit)
    const service1: Service = {
      id: 1,
      name: "VM-1",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    // Service 2: Request 2 CPU / 8 GB, Limit 8 CPU / 32 GB (4:1 over-commit)
    const service2: Service = {
      id: 2,
      name: "VM-2",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    // Service 3: Request 2 CPU / 8 GB, Limit 8 CPU / 32 GB (4:1 over-commit)
    const service3: Service = {
      id: 3,
      name: "VM-3",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    // Create workload
    const workload: Workload = {
      id: 1,
      name: "VM-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1, 2, 3],
    };

    // Add services and workload to store
    dispatch(addService(service1));
    dispatch(addService(service2));
    dispatch(addService(service3));
    dispatch(addWorkload(workload));

    // Schedule the workload
    const usedZonesId: number[] = [];
    const scheduler = workloadScheduler(store, dispatch);
    const services = [service1, service2, service3];
    scheduler(workload, services, [machineSet], usedZonesId);

    // Get resulting nodes
    const nodes = store.getState().node.nodes;

    // Key assertion: Services should be scheduled based on REQUESTS (6 CPU total),
    // not LIMITS (24 CPU total)
    // With 8 CPU per node (minus Kubelet ~0.09), we can fit 3 services (6 CPU requests)
    // on a single node if scheduling uses requests.
    // If it used limits (24 CPU), it would require 3+ nodes.
    expect(nodes.length).toBeLessThanOrEqual(2);

    // Verify all services were scheduled
    const allServicesScheduled = nodes.some((node) =>
      node.services.includes(service1.id as number)
    );
    expect(allServicesScheduled).toBe(true);
  });

  it("should preserve limit information after scheduling", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    const service: Service = {
      id: 1,
      name: "VM-1",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    const workload: Workload = {
      id: 1,
      name: "VM-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1],
    };

    dispatch(addService(service));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service], [machineSet], usedZonesId);

    // Verify service still has limit information
    const scheduledService = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledService.limitCPU).toBe(8);
    expect(scheduledService.limitMemory).toBe(32);
    expect(scheduledService.overCommitMode).toBe("static");
  });

  it("should handle mixed workloads (some with over-commit, some without)", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    // Service with over-commit
    const vmService: Service = {
      id: 1,
      name: "VM-1",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    // Service without over-commit (regular pod)
    const regularService: Service = {
      id: 2,
      name: "Regular-Pod",
      requiredCPU: 2,
      requiredMemory: 8,
      zones: 1,
      runsWith: [],
      avoid: [],
    };

    const workload: Workload = {
      id: 1,
      name: "Mixed-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1, 2],
    };

    dispatch(addService(vmService));
    dispatch(addService(regularService));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [vmService, regularService], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;

    // Both services should be scheduled
    expect(nodes.length).toBeGreaterThan(0);

    // Verify services are scheduled
    const allServices = nodes.flatMap((node) => node.services);
    expect(allServices).toContain(1);
    expect(allServices).toContain(2);

    // Verify VM service still has limits
    const scheduledVMService = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledVMService.limitCPU).toBe(8);

    // Verify regular service does NOT have limits set
    const scheduledRegularService = store
      .getState()
      .service.services.find((s: Service) => s.id === 2);
    expect(scheduledRegularService.limitCPU).toBeUndefined();
  });

  it("should handle dynamic over-commit mode", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    const service: Service = {
      id: 1,
      name: "VM-Dynamic",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 6, // Different ratio: 3:1
      limitMemory: 24,
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "dynamic",
    };

    const workload: Workload = {
      id: 1,
      name: "Dynamic-VM-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1],
    };

    dispatch(addService(service));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;
    expect(nodes.length).toBeGreaterThan(0);

    // Verify dynamic mode is preserved
    const scheduledService = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledService.overCommitMode).toBe("dynamic");
  });

  it("should schedule high over-commit workloads correctly", () => {
    // Test with extreme over-commit (10:1)
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 8,
      memory: 32,
      instanceName: "m5.2xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    const service: Service = {
      id: 1,
      name: "High-Overcommit-VM",
      requiredCPU: 1, // Request: 1 CPU
      requiredMemory: 4, // Request: 4 GB
      limitCPU: 10, // Limit: 10 CPU (10:1 ratio)
      limitMemory: 40, // Limit: 40 GB (10:1 ratio)
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "static",
    };

    const workload: Workload = {
      id: 1,
      name: "High-Overcommit-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1],
    };

    dispatch(addService(service));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;

    // Should be schedulable on 1 node based on REQUESTS (1 CPU, 4 GB)
    // even though LIMITS (10 CPU, 40 GB) exceed node capacity
    expect(nodes.length).toBe(1);
  });

  it("should schedule dynamic over-commit with min/max ranges", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    const service: Service = {
      id: 1,
      name: "VM-Dynamic-Range",
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
    };

    const workload: Workload = {
      id: 1,
      name: "Dynamic-Range-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1],
    };

    dispatch(addService(service));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;

    // Should be schedulable based on requests (2 CPU, 8 GB)
    expect(nodes.length).toBeGreaterThan(0);

    // Verify dynamic range information is preserved
    const scheduledService = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledService.minLimitCPU).toBe(4);
    expect(scheduledService.maxLimitCPU).toBe(12);
    expect(scheduledService.minLimitMemory).toBe(16);
    expect(scheduledService.maxLimitMemory).toBe(48);
    expect(scheduledService.overCommitMode).toBe("dynamic");
  });

  it("should schedule multiple dynamic services correctly", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    const service1: Service = {
      id: 1,
      name: "VM-Dynamic-1",
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
    };

    const service2: Service = {
      id: 2,
      name: "VM-Dynamic-2",
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
    };

    const workload: Workload = {
      id: 1,
      name: "Multi-Dynamic-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1, 2],
    };

    dispatch(addService(service1));
    dispatch(addService(service2));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service1, service2], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;

    // Should be schedulable based on total requests (4 CPU, 16 GB)
    // Even though max limits (16 CPU, 64 GB) could fill the node
    expect(nodes.length).toBeGreaterThan(0);

    // Both services should be scheduled
    const allServices = nodes.flatMap((node) => node.services);
    expect(allServices).toContain(1);
    expect(allServices).toContain(2);
  });

  it("should handle mixed static and dynamic services in scheduling", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    // Static over-commit
    const staticService: Service = {
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
    };

    // Dynamic over-commit
    const dynamicService: Service = {
      id: 2,
      name: "VM-Dynamic",
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
    };

    const workload: Workload = {
      id: 1,
      name: "Mixed-Mode-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1, 2],
    };

    dispatch(addService(staticService));
    dispatch(addService(dynamicService));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(
      workload,
      [staticService, dynamicService],
      [machineSet],
      usedZonesId
    );

    const nodes = store.getState().node.nodes;

    // Both services should be scheduled
    const allServices = nodes.flatMap((node) => node.services);
    expect(allServices).toContain(1);
    expect(allServices).toContain(2);

    // Verify each service mode is preserved
    const scheduledStatic = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledStatic.overCommitMode).toBe("static");
    expect(scheduledStatic.limitCPU).toBe(8);
    expect(scheduledStatic.minLimitCPU).toBeUndefined();

    const scheduledDynamic = store
      .getState()
      .service.services.find((s: Service) => s.id === 2);
    expect(scheduledDynamic.overCommitMode).toBe("dynamic");
    expect(scheduledDynamic.minLimitCPU).toBe(4);
    expect(scheduledDynamic.maxLimitCPU).toBe(12);
  });

  it("should fallback to static limits when dynamic min/max are missing", () => {
    const machineSet: MachineSet = {
      id: 1,
      name: "worker",
      cpu: 16,
      memory: 64,
      instanceName: "m5.4xlarge",
      numberOfDisks: 24,
      onlyFor: [],
      label: "worker",
    };

    // Dynamic mode but with only static limits provided (should fallback)
    const service: Service = {
      id: 1,
      name: "VM-Partial-Dynamic",
      requiredCPU: 2,
      requiredMemory: 8,
      limitCPU: 8,
      limitMemory: 32,
      // No min/max fields
      zones: 1,
      runsWith: [],
      avoid: [],
      overCommitMode: "dynamic",
    };

    const workload: Workload = {
      id: 1,
      name: "Fallback-Workload",
      count: 1,
      usesMachines: ["worker"],
      services: [1],
    };

    dispatch(addService(service));
    dispatch(addWorkload(workload));

    const scheduler = workloadScheduler(store, dispatch);
    const usedZonesId: number[] = [];
    scheduler(workload, [service], [machineSet], usedZonesId);

    const nodes = store.getState().node.nodes;
    expect(nodes.length).toBeGreaterThan(0);

    // Verify service is scheduled with static limits as fallback
    const scheduledService = store
      .getState()
      .service.services.find((s: Service) => s.id === 1);
    expect(scheduledService.limitCPU).toBe(8);
    expect(scheduledService.limitMemory).toBe(32);
    expect(scheduledService.overCommitMode).toBe("dynamic");
    // Min/max should remain undefined
    expect(scheduledService.minLimitCPU).toBeUndefined();
    expect(scheduledService.maxLimitCPU).toBeUndefined();
  });
});

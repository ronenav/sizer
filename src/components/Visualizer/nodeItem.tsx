import * as React from "react";
import {
  Card,
  CardBody,
  CardFooter,
  CardHeaderMain,
  CardTitle,
  Progress,
  ProgressMeasureLocation,
  Title,
  Label,
} from "@patternfly/react-core";
import { DatabaseIcon, CpuIcon, MemoryIcon } from "@patternfly/react-icons";
import { Node } from "../../types";
import "./nodeItem.css";
import { useSelector } from "react-redux";
import { Store } from "../../redux";
import {
  getTotalResourceRequirement,
  calculateNodeOverCommit,
} from "../../utils/common";

type NodeItemProps = {
  node: Node;
  title: string;
};

const NodeItem: React.FC<NodeItemProps> = ({ node, title }) => {
  const services = useSelector((store: Store) => store.service.services).filter(
    (service) => node.services.includes(service.id as number)
  );
  const {
    totalMem: usedMem,
    totalCPU: usedCPU,
    totalDisks,
  } = getTotalResourceRequirement(services);
  const instanceType = node.machineSet;

  // Calculate over-commit metrics for this node
  const overCommitMetrics = React.useMemo(
    () => calculateNodeOverCommit(node, services),
    [node, services]
  );

  const hasOverCommit =
    overCommitMetrics.cpuOverCommitRatio > 1 ||
    overCommitMetrics.memoryOverCommitRatio > 1;

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case "high":
        return "red";
      case "medium":
        return "orange";
      case "low":
        return "blue";
      default:
        return "green";
    }
  };

  return (
    <Card>
      <CardHeaderMain>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          <Title headingLevel="h2" className="card-container__title">
            {title}
          </Title>
          {hasOverCommit && (
            <Label color={getRiskColor(overCommitMetrics.riskLevel)} isCompact>
              Over-Commit:{" "}
              {Math.max(
                overCommitMetrics.cpuOverCommitRatio,
                overCommitMetrics.memoryOverCommitRatio
              ).toFixed(2)}
              :1
            </Label>
          )}
        </div>
      </CardHeaderMain>
      <CardTitle id="instance-type" className="card-container--alignCenter">
        {instanceType}
      </CardTitle>
      <CardBody className="card-container__disk-section">
        <DatabaseIcon color="#C9190B" width="3em" height="3em" />
        <Title className="card-container-disk-section__count" headingLevel="h3">
          x {totalDisks}
        </Title>
      </CardBody>
      <div id="resource-bars">
        <CardBody>
          <CpuIcon /> CPU
          <Progress
            value={(usedCPU / node.cpuUnits) * 100}
            measureLocation={ProgressMeasureLocation.none}
            aria-label="CPU"
          />
          {hasOverCommit && (
            <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Req: {overCommitMetrics.requestedCPU.toFixed(2)} | Lim:{" "}
              {overCommitMetrics.limitCPU.toFixed(2)}
            </div>
          )}
        </CardBody>
        <CardBody>
          <MemoryIcon /> Memory{" "}
          <Progress
            value={(usedMem / node.memory) * 100}
            measureLocation={ProgressMeasureLocation.none}
            aria-label="Memory"
          />
          {hasOverCommit && (
            <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Req: {overCommitMetrics.requestedMemory.toFixed(2)} GB | Lim:{" "}
              {overCommitMetrics.limitMemory.toFixed(2)} GB
            </div>
          )}
        </CardBody>
      </div>
      <CardFooter>
        {" "}
        {node.cpuUnits} CPUs | {node.memory} GB RAM
      </CardFooter>
    </Card>
  );
};

export default NodeItem;

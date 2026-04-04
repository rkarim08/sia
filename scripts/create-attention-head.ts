// scripts/create-attention-head.ts
//
// Creates the initial SIA attention fusion head ONNX model.
// This is the Phase 0 bootstrap model that mimics RRF behavior.
//
// Architecture (simplified for bootstrap):
//   Input: features [K, 405] — K candidates × 405 features
//   Linear(405, 128) → ReLU → Linear(128, 1) → Sigmoid → scores [K, 1]
//
// The full 2-layer 4-head transformer architecture will be trained
// via the feedback trainer once sufficient data is collected.
//
// Usage: npx tsx scripts/create-attention-head.ts [output-path]

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// onnx-proto is CJS-only; use createRequire for ESM compat
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { onnx } = require("onnx-proto") as { onnx: typeof import("onnx-proto").onnx };
const Long = require("long") as typeof import("long");

const FEATURE_DIM = 405;
const HIDDEN_DIM = 128;
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = process.argv[2] || join(__dirname, "../models");

function createFloat32Tensor(
	name: string,
	dims: number[],
	data: number[],
): onnx.TensorProto {
	const tensor = new onnx.TensorProto();
	tensor.name = name;
	tensor.dataType = onnx.TensorProto.DataType.FLOAT;
	tensor.dims = dims.map((d) => Long.fromNumber(d));
	tensor.floatData = data;
	return tensor;
}

// Initialize weights to mimic RRF:
// The first 4 features are [BM25, vec, graph, CE] scores.
// Initialize the first linear layer to weight these heavily:
// W1[0:4, :] = high weights, rest = small random
function initRrfMimicWeights(): {
	w1: number[];
	b1: number[];
	w2: number[];
	b2: number[];
} {
	const w1 = new Array(FEATURE_DIM * HIDDEN_DIM);
	const b1 = new Array(HIDDEN_DIM).fill(0);
	const w2 = new Array(HIDDEN_DIM).fill(0);
	const b2 = [0];

	// Initialize W1 with small random values
	for (let i = 0; i < w1.length; i++) {
		w1[i] = (Math.random() - 0.5) * 0.01;
	}

	// Boost weights for the 4 retrieval scores (indices 0-3)
	// and trust weight (index 4) to mimic RRF
	const rrfWeights = [0.3, 0.25, 0.2, 0.25, 0.5]; // BM25, vec, graph, CE, trust
	for (let scoreIdx = 0; scoreIdx < 5; scoreIdx++) {
		for (let h = 0; h < HIDDEN_DIM; h++) {
			w1[scoreIdx * HIDDEN_DIM + h] = rrfWeights[scoreIdx] * (1.0 / HIDDEN_DIM);
		}
	}

	// W2: uniform weights to sum hidden dim → single score
	for (let h = 0; h < HIDDEN_DIM; h++) {
		w2[h] = 1.0 / HIDDEN_DIM;
	}

	return { w1, b1, w2, b2 };
}

function buildModel(): Uint8Array {
	const { w1, b1, w2, b2 } = initRrfMimicWeights();

	// Nodes
	const matmul1 = new onnx.NodeProto();
	matmul1.opType = "MatMul";
	matmul1.input = ["features", "W1"];
	matmul1.output = ["hidden_raw"];
	matmul1.name = "matmul1";

	const add1 = new onnx.NodeProto();
	add1.opType = "Add";
	add1.input = ["hidden_raw", "B1"];
	add1.output = ["hidden_biased"];
	add1.name = "add1";

	const relu = new onnx.NodeProto();
	relu.opType = "Relu";
	relu.input = ["hidden_biased"];
	relu.output = ["hidden"];
	relu.name = "relu";

	const matmul2 = new onnx.NodeProto();
	matmul2.opType = "MatMul";
	matmul2.input = ["hidden", "W2"];
	matmul2.output = ["logits"];
	matmul2.name = "matmul2";

	const add2 = new onnx.NodeProto();
	add2.opType = "Add";
	add2.input = ["logits", "B2"];
	add2.output = ["logits_biased"];
	add2.name = "add2";

	const sigmoid = new onnx.NodeProto();
	sigmoid.opType = "Sigmoid";
	sigmoid.input = ["logits_biased"];
	sigmoid.output = ["scores"];
	sigmoid.name = "sigmoid";

	// Input/output value info
	const featuresInput = new onnx.ValueInfoProto();
	featuresInput.name = "features";
	featuresInput.type = new onnx.TypeProto();
	featuresInput.type.tensorType = new onnx.TypeProto.Tensor();
	featuresInput.type.tensorType.elemType = onnx.TensorProto.DataType.FLOAT;
	featuresInput.type.tensorType.shape = new onnx.TensorShapeProto();
	featuresInput.type.tensorType.shape.dim = [
		Object.assign(new onnx.TensorShapeProto.Dimension(), { dimParam: "K" }),
		Object.assign(new onnx.TensorShapeProto.Dimension(), { dimValue: Long.fromNumber(FEATURE_DIM) }),
	];

	const scoresOutput = new onnx.ValueInfoProto();
	scoresOutput.name = "scores";
	scoresOutput.type = new onnx.TypeProto();
	scoresOutput.type.tensorType = new onnx.TypeProto.Tensor();
	scoresOutput.type.tensorType.elemType = onnx.TensorProto.DataType.FLOAT;
	scoresOutput.type.tensorType.shape = new onnx.TensorShapeProto();
	scoresOutput.type.tensorType.shape.dim = [
		Object.assign(new onnx.TensorShapeProto.Dimension(), { dimParam: "K" }),
		Object.assign(new onnx.TensorShapeProto.Dimension(), { dimValue: Long.fromNumber(1) }),
	];

	// Initializers (weight tensors)
	const W1 = createFloat32Tensor("W1", [FEATURE_DIM, HIDDEN_DIM], w1);
	const B1 = createFloat32Tensor("B1", [HIDDEN_DIM], b1);
	const W2 = createFloat32Tensor("W2", [HIDDEN_DIM, 1], w2);
	const B2 = createFloat32Tensor("B2", [1], b2);

	// Graph
	const graph = new onnx.GraphProto();
	graph.name = "sia_attention_fusion_head";
	graph.node = [matmul1, add1, relu, matmul2, add2, sigmoid];
	graph.input = [featuresInput];
	graph.output = [scoresOutput];
	graph.initializer = [W1, B1, W2, B2];

	// Model
	const model = new onnx.ModelProto();
	model.irVersion = Long.fromNumber(8);
	model.graph = graph;

	const opset = new onnx.OperatorSetIdProto();
	opset.version = Long.fromNumber(17);
	model.opsetImport = [opset];

	model.producerName = "sia-transformer-stack";
	model.producerVersion = "1.0.0";
	model.modelVersion = Long.fromNumber(1);

	return onnx.ModelProto.encode(model).finish();
}

// Main
const modelBytes = buildModel();
const outputPath = join(OUTPUT_DIR, "sia-attention-head", "model.onnx");

if (!existsSync(dirname(outputPath))) {
	mkdirSync(dirname(outputPath), { recursive: true });
}

writeFileSync(outputPath, Buffer.from(modelBytes));
console.log(`Created attention head model at: ${outputPath}`);
console.log(`Size: ${modelBytes.length} bytes`);
console.log(`Parameters: ${FEATURE_DIM * HIDDEN_DIM + HIDDEN_DIM + HIDDEN_DIM + 1} = ~${Math.round((FEATURE_DIM * HIDDEN_DIM + HIDDEN_DIM + HIDDEN_DIM + 1) / 1000)}K`);

/**
 * Inference Engine - Main Entry Point
 * 
 * This module provides access to inference and constraint-checking utilities.
 */

var constraints = require('./constraints');
var contractTerm = require('./contract-term');
var ambiguity = require('./ambiguity');
var pipeline = require('./pipeline');

module.exports = {
	// Constraints
	constraints: constraints,
	
	// Contract term inference
	contractTerm: contractTerm,
	Confidence: contractTerm.Confidence,
	
	// Ambiguity tracking and resolution
	ambiguity: ambiguity,
	AmbiguityType: ambiguity.AmbiguityType,
	AmbiguityCollector: ambiguity.AmbiguityCollector,
	
	// Full pipeline
	pipeline: pipeline
};

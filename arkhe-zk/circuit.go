// circuit.go
package arkhe_zk

import (
	"github.com/consensys/gnark/frontend"
)

// CoherenceCircuit prova que o validador é elegível para votar
// sem revelar seu score exato.
type CoherenceCircuit struct {
	// Witness (Privado)
	CurrentScore frontend.Variable `gnark:",secret"` // C
	RandomSalt   frontend.Variable `gnark:",secret"` // Para cegar a prova

	// Public Inputs (Públicos)
	Threshold      frontend.Variable // T (ex: 0.85)
	LearningRate   frontend.Variable // Eta
	PublicCommitment frontend.Variable // Hash(C || Salt) para identificação

	// Saída pública (opcional)
	NewScoreCommitment frontend.Variable // Hash(C' || Salt)
}

// Define define as restrições do circuito
func (c *CoherenceCircuit) Define(api frontend.API) error {
	// 1. Provar que C >= Threshold
	// Em gnark, usamos AssertIsLessOrEqual(threshold, score)
	api.AssertIsLessOrEqual(c.Threshold, c.CurrentScore)

	// 2. Física da coerência: C <= 1
	// (Simplificando C como inteiro escalonado para o circuito)
	// api.AssertIsLessOrEqual(c.CurrentScore, 10000)

	return nil
}

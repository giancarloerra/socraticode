// prover.go
package arkhe_zk

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
)

// Prover encapsula a lógica de geração de prova
type Prover struct {
	cs constraint.ConstraintSystem
	pk groth16.ProvingKey
}

// GenerateProof cria uma prova ZK para os dados fornecidos
func (p *Prover) GenerateProof(score, threshold float64) (groth16.Proof, witness.Witness, error) {
	// 1. Atribuição
	assignment := &CoherenceCircuit{
		CurrentScore:    score,
		Threshold:       threshold,
	}

	// 2. Testemunha (Witness)
	fullWitness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return nil, nil, err
	}

	// 3. Prova
	proof, err := groth16.Prove(p.cs, p.pk, fullWitness)
	if err != nil {
		return nil, nil, err
	}

	// 4. Testemunha Pública
	publicWitness, err := fullWitness.Public()
	if err != nil {
		return nil, nil, err
	}

	return proof, publicWitness, nil
}

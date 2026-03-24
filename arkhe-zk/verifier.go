// verifier.go
package arkhe_zk

import (
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/witness"
)

// Verifier encapsula a lógica de verificação
type Verifier struct {
	vk groth16.VerifyingKey
}

// VerifyProof verifica se a prova é válida
func (v *Verifier) VerifyProof(proof groth16.Proof, publicWitness witness.Witness) (bool, error) {
	err := groth16.Verify(proof, v.vk, publicWitness)
	if err != nil {
		return false, err
	}
	return true, nil
}

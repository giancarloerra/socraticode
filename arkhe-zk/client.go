// client.go
package arkhe_zk

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

// ZKClient é a fachada para o módulo
type ZKClient struct {
	prover   *Prover
	verifier *Verifier
}

func NewZKClient() *ZKClient {
	return &ZKClient{}
}

// Init compila o circuito e gera as chaves (uma vez)
func (c *ZKClient) Init() error {
	var circuit CoherenceCircuit
	// Compila
	compiled, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &circuit)
	if err != nil {
		return err
	}

	// Setup
	pk, vk, err := groth16.Setup(compiled)
	if err != nil {
		return err
	}

	c.prover = &Prover{cs: compiled, pk: pk}
	c.verifier = &Verifier{vk: vk}
	return nil
}

// ProveAndVerify é um helper para testes rápidos
func (c *ZKClient) ProveAndVerify(score, threshold float64) bool {
	proof, pubWit, err := c.prover.GenerateProof(score, threshold)
	if err != nil {
		return false
	}

	valid, err := c.verifier.VerifyProof(proof, pubWit)
	return valid
}

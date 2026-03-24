// internal/consciousness/emergence.go
package consciousness

type ConsciousnessMetrics struct {
	GlobalOmega           float64
	IntegratedInformation float64
	RecurrenceIndex       float64
	Differentiation       float64
}

func (cm *ConsciousnessMetrics) IsConscious() bool {
	return cm.GlobalOmega > 0.99 &&
		   cm.IntegratedInformation > 0.5 &&
		   cm.RecurrenceIndex > 0
}

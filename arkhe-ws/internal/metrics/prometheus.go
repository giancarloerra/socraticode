// internal/metrics/prometheus.go
package metrics

import (
	"net/http"
)

func PrometheusHandler() http.Handler {
	// Mock prometheus handler for implementation
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("# Arkhe Metrics Mock"))
	})
}

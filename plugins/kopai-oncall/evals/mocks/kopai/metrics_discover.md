{
  "metrics": [
    {
      "name": "http.server.request.duration",
      "type": "Histogram",
      "unit": "s",
      "description": "Duration of HTTP server requests.",
      "attributeKeys": [
        "http.request.method",
        "http.route",
        "http.response.status_code"
      ],
      "resourceAttributeKeys": [
        "service.name",
        "service.version",
        "deployment.environment.name"
      ]
    },
    {
      "name": "http.client.request.duration",
      "type": "Histogram",
      "unit": "s",
      "description": "Duration of HTTP client requests.",
      "attributeKeys": [
        "http.request.method",
        "server.address",
        "http.response.status_code",
        "error.type"
      ],
      "resourceAttributeKeys": [
        "service.name",
        "service.version",
        "deployment.environment.name"
      ]
    },
    {
      "name": "process.cpu.utilization",
      "type": "Gauge",
      "unit": "1",
      "attributeKeys": [],
      "resourceAttributeKeys": [
        "service.name"
      ]
    }
  ]
}

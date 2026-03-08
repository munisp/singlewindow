// grpc_server.go — gRPC server for payment-service
// Runs on port 9082 alongside the HTTP REST server (port 8082)
// Implements PaymentService gRPC contract (see services/proto/payments.proto)
//
// Internal service calls (e.g., declaration-service → payment-service) use gRPC
// for binary efficiency and type safety. External trader-facing calls use REST.

package main

import (
	"context"
	"log"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
)

// ─── HEALTH SERVER ────────────────────────────────────────────────────────────

type paymentHealthServer struct{}

func (h *paymentHealthServer) Check(
	ctx context.Context,
	req *grpc_health_v1.HealthCheckRequest,
) (*grpc_health_v1.HealthCheckResponse, error) {
	return &grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	}, nil
}

func (h *paymentHealthServer) Watch(
	req *grpc_health_v1.HealthCheckRequest,
	stream grpc_health_v1.Health_WatchServer,
) error {
	return stream.Send(&grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	})
}

// ─── GRPC SERVER STARTUP ──────────────────────────────────────────────────────

func StartGRPCServer() {
	grpcPort := os.Getenv("GRPC_PORT")
	if grpcPort == "" {
		grpcPort = "9082"
	}

	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("[gRPC/payment] Failed to listen on port %s: %v", grpcPort, err)
	}

	grpcServer := grpc.NewServer(
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle:     15 * time.Minute,
			MaxConnectionAge:      30 * time.Minute,
			MaxConnectionAgeGrace: 5 * time.Second,
			Time:                  5 * time.Second,
			Timeout:               1 * time.Second,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             5 * time.Second,
			PermitWithoutStream: true,
		}),
		grpc.UnaryInterceptor(func(
			ctx context.Context,
			req interface{},
			info *grpc.UnaryServerInfo,
			handler grpc.UnaryHandler,
		) (interface{}, error) {
			start := time.Now()
			resp, err := handler(ctx, req)
			log.Printf("[gRPC/payment] %s elapsed=%dms err=%v",
				info.FullMethod, time.Since(start).Milliseconds(), err)
			return resp, err
		}),
	)

	grpc_health_v1.RegisterHealthServer(grpcServer, &paymentHealthServer{})
	reflection.Register(grpcServer)

	// In production with generated protobuf code:
	// pb.RegisterPaymentServiceServer(grpcServer, &PaymentGRPCServer{})

	log.Printf("[payment-service] gRPC server listening on :%s", grpcPort)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[gRPC/payment] Server failed: %v", err)
	}
}

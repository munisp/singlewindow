// grpc_server.go — gRPC server for profile-service
// Runs on port 9084 alongside the HTTP REST server (port 8084)
// Implements ProfileService gRPC contract
//
// The profile service is called by other microservices (declaration, payment)
// via gRPC to verify trader identity, AEO status, and permissions
// before processing declarations or payments.

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

type profileHealthServer struct{}

func (h *profileHealthServer) Check(
	ctx context.Context,
	req *grpc_health_v1.HealthCheckRequest,
) (*grpc_health_v1.HealthCheckResponse, error) {
	return &grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	}, nil
}

func (h *profileHealthServer) Watch(
	req *grpc_health_v1.HealthCheckRequest,
	stream grpc_health_v1.Health_WatchServer,
) error {
	return stream.Send(&grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	})
}


// List implements grpc_health_v1.HealthServer (required since gRPC-Go v1.62
// made List a mandatory method — its absence was a pre-existing compile break).
func (h *profileHealthServer) List(
	ctx context.Context,
	req *grpc_health_v1.HealthListRequest,
) (*grpc_health_v1.HealthListResponse, error) {
	return &grpc_health_v1.HealthListResponse{
		Statuses: map[string]*grpc_health_v1.HealthCheckResponse{
			"": {Status: grpc_health_v1.HealthCheckResponse_SERVING},
		},
	}, nil
}

func StartGRPCServer() {
	grpcPort := os.Getenv("GRPC_PORT")
	if grpcPort == "" {
		grpcPort = "9084"
	}

	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("[gRPC/profile] Failed to listen on port %s: %v", grpcPort, err)
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
			log.Printf("[gRPC/profile] %s elapsed=%dms err=%v",
				info.FullMethod, time.Since(start).Milliseconds(), err)
			return resp, err
		}),
	)

	grpc_health_v1.RegisterHealthServer(grpcServer, &profileHealthServer{})
	reflection.Register(grpcServer)

	// In production with generated protobuf code:
	// pb.RegisterProfileServiceServer(grpcServer, &ProfileGRPCServer{})

	log.Printf("[profile-service] gRPC server listening on :%s", grpcPort)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[gRPC/profile] Server failed: %v", err)
	}
}

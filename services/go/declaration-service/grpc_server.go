// grpc_server.go — gRPC server implementation for declaration-service
// Runs on port 9081 alongside the HTTP REST server (port 8081)
// Implements the DeclarationService protobuf contract
//
// gRPC advantages over REST for internal service communication:
// - Binary protobuf encoding (~10x smaller payloads than JSON)
// - HTTP/2 multiplexing (multiple concurrent streams per connection)
// - Strongly typed contracts (compile-time safety)
// - Bidirectional streaming for real-time status updates
// - Native load balancing support in Kubernetes

package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

// ─── GRPC SERVICE IMPLEMENTATION ─────────────────────────────────────────────

// DeclarationGRPCServer implements the DeclarationService gRPC interface
// The actual business logic delegates to the same database functions used by HTTP handlers
type DeclarationGRPCServer struct {
	// UnimplementedDeclarationServiceServer provides default implementations
	// for any unimplemented methods (forward compatibility)
}

// SubmitDeclaration creates a new declaration and returns its ID and URN
func (s *DeclarationGRPCServer) SubmitDeclaration(
	ctx context.Context,
	req *SubmitDeclarationGRPCRequest,
) (*SubmitDeclarationGRPCResponse, error) {
	if req.TraderId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "trader_id must be positive")
	}
	if req.HsCode == "" {
		return nil, status.Error(codes.InvalidArgument, "hs_code is required")
	}
	if req.DeclaredValue <= 0 {
		return nil, status.Error(codes.InvalidArgument, "declared_value must be positive")
	}

	// Generate URN and declaration number
	urn := fmt.Sprintf("URN-%d-%d", req.TraderId, time.Now().UnixMilli())
	declNum := fmt.Sprintf("DECL-%d", time.Now().UnixMilli())

	// Insert into PostgreSQL
	var id int64
	err := db.QueryRow(ctx, `
		INSERT INTO declarations (
			declaration_number, ucr, trader_id, declaration_type, status,
			hs_code, goods_description, country_of_origin, gross_weight_kg,
			invoice_value, invoice_currency, num_packages, risk_lane, risk_score
		) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, 'yellow', 0.3)
		RETURNING id
	`,
		declNum, urn, req.TraderId, req.DeclarationType,
		req.HsCode, req.Description, req.OriginCountry,
		req.GrossWeightKg, req.DeclaredValue, req.Currency,
		req.NumPackages,
	).Scan(&id)

	if err != nil {
		log.Printf("[gRPC] SubmitDeclaration DB error: %v", err)
		return nil, status.Errorf(codes.Internal, "failed to create declaration: %v", err)
	}

	log.Printf("[gRPC] SubmitDeclaration: id=%d urn=%s trader=%d", id, urn, req.TraderId)

	return &SubmitDeclarationGRPCResponse{
		DeclarationId: id,
		Urn:           urn,
		Status:        "draft",
		RiskLane:      "yellow",
		RiskScore:     0.3,
		CreatedAt:     time.Now().UnixMilli(),
	}, nil
}

// GetDeclaration retrieves a declaration by ID
func (s *DeclarationGRPCServer) GetDeclaration(
	ctx context.Context,
	req *GetDeclarationGRPCRequest,
) (*DeclarationGRPC, error) {
	if req.DeclarationId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "declaration_id must be positive")
	}

	var d Declaration
	err := db.QueryRow(ctx, `
		SELECT id, declaration_number, ucr, trader_id, declaration_type, status,
		       hs_code, goods_description, country_of_origin, gross_weight_kg,
		       invoice_value, invoice_currency, risk_lane, risk_score,
		       duty_amount, vat_amount, created_at, updated_at
		FROM declarations WHERE id = $1
	`, req.DeclarationId).Scan(
		&d.ID, &d.DeclarationNumber, &d.UCR, &d.TraderID, &d.DeclarationType,
		&d.Status, &d.HSCode, &d.GoodsDescription, &d.CountryOfOrigin,
		&d.GrossWeight, &d.InvoiceValue, &d.InvoiceCurrency,
		&d.RiskLane, &d.RiskScore, &d.DutyAmount, &d.VatAmount,
		&d.CreatedAt, &d.UpdatedAt,
	)

	if err != nil {
		return nil, status.Errorf(codes.NotFound, "declaration %d not found", req.DeclarationId)
	}

	return &DeclarationGRPC{
		Id:              d.ID,
		Urn:             d.UCR,
		TraderId:        d.TraderID,
		DeclarationType: d.DeclarationType,
		HsCode:          d.HSCode,
		Description:     d.GoodsDescription,
		OriginCountry:   d.CountryOfOrigin,
		Status:          d.Status,
		CreatedAt:       d.CreatedAt.UnixMilli(),
		UpdatedAt:       d.UpdatedAt.UnixMilli(),
	}, nil
}

// UpdateDeclarationStatus updates the status of a declaration
func (s *DeclarationGRPCServer) UpdateDeclarationStatus(
	ctx context.Context,
	req *UpdateStatusGRPCRequest,
) (*UpdateStatusGRPCResponse, error) {
	if req.DeclarationId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "declaration_id must be positive")
	}

	validStatuses := map[string]bool{
		"draft": true, "submitted": true, "under_review": true,
		"pending_payment": true, "cleared": true, "rejected": true, "cancelled": true,
	}
	if !validStatuses[req.NewStatus] {
		return nil, status.Errorf(codes.InvalidArgument, "invalid status: %s", req.NewStatus)
	}

	_, err := db.Exec(ctx, `
		UPDATE declarations SET status = $1, updated_at = NOW() WHERE id = $2
	`, req.NewStatus, req.DeclarationId)

	if err != nil {
		return nil, status.Errorf(codes.Internal, "update failed: %v", err)
	}

	return &UpdateStatusGRPCResponse{
		Success:   true,
		Status:    req.NewStatus,
		UpdatedAt: time.Now().UnixMilli(),
	}, nil
}

// ─── GRPC MESSAGE TYPES ───────────────────────────────────────────────────────
// These are simplified Go structs mirroring the protobuf messages.
// In production: use generated code from protoc-gen-go.

type SubmitDeclarationGRPCRequest struct {
	TraderId        int64   `json:"trader_id"`
	DeclarationType string  `json:"declaration_type"`
	HsCode          string  `json:"hs_code"`
	Description     string  `json:"description"`
	OriginCountry   string  `json:"origin_country"`
	DeclaredValue   float64 `json:"declared_value"`
	Currency        string  `json:"currency"`
	GrossWeightKg   float64 `json:"gross_weight_kg"`
	NumPackages     int32   `json:"num_packages"`
}

type SubmitDeclarationGRPCResponse struct {
	DeclarationId int64   `json:"declaration_id"`
	Urn           string  `json:"urn"`
	Status        string  `json:"status"`
	RiskLane      string  `json:"risk_lane"`
	RiskScore     float64 `json:"risk_score"`
	CreatedAt     int64   `json:"created_at"`
}

type GetDeclarationGRPCRequest struct {
	DeclarationId int64 `json:"declaration_id"`
}

type DeclarationGRPC struct {
	Id              int64  `json:"id"`
	Urn             string `json:"urn"`
	TraderId        int64  `json:"trader_id"`
	DeclarationType string `json:"declaration_type"`
	HsCode          string `json:"hs_code"`
	Description     string `json:"description"`
	OriginCountry   string `json:"origin_country"`
	Status          string `json:"status"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
}

type UpdateStatusGRPCRequest struct {
	DeclarationId int64  `json:"declaration_id"`
	NewStatus     string `json:"new_status"`
	OfficerId     string `json:"officer_id"`
	Notes         string `json:"notes"`
}

type UpdateStatusGRPCResponse struct {
	Success   bool   `json:"success"`
	Status    string `json:"status"`
	UpdatedAt int64  `json:"updated_at"`
}

// ─── HEALTH CHECK SERVER ──────────────────────────────────────────────────────

type healthServer struct{}

func (h *healthServer) Check(
	ctx context.Context,
	req *grpc_health_v1.HealthCheckRequest,
) (*grpc_health_v1.HealthCheckResponse, error) {
	return &grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	}, nil
}

func (h *healthServer) Watch(
	req *grpc_health_v1.HealthCheckRequest,
	stream grpc_health_v1.Health_WatchServer,
) error {
	return stream.Send(&grpc_health_v1.HealthCheckResponse{
		Status: grpc_health_v1.HealthCheckResponse_SERVING,
	})
}

// ─── GRPC SERVER STARTUP ──────────────────────────────────────────────────────

// StartGRPCServer starts the gRPC server on a separate port
// Called from main() in a goroutine alongside the HTTP server
func StartGRPCServer() {
	grpcPort := os.Getenv("GRPC_PORT")
	if grpcPort == "" {
		grpcPort = "9081"
	}

	lis, err := net.Listen("tcp", ":"+grpcPort)
	if err != nil {
		log.Fatalf("[gRPC] Failed to listen on port %s: %v", grpcPort, err)
	}

	// Configure gRPC server with production-grade settings
	grpcServer := grpc.NewServer(
		// Keep-alive settings for long-lived connections
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
		// Unary interceptor for logging
		grpc.UnaryInterceptor(func(
			ctx context.Context,
			req interface{},
			info *grpc.UnaryServerInfo,
			handler grpc.UnaryHandler,
		) (interface{}, error) {
			start := time.Now()
			resp, err := handler(ctx, req)
			log.Printf("[gRPC] %s elapsed=%dms err=%v",
				info.FullMethod, time.Since(start).Milliseconds(), err)
			return resp, err
		}),
	)

	// Register health check service (used by Kubernetes liveness probes and gRPC load balancers)
	grpc_health_v1.RegisterHealthServer(grpcServer, &healthServer{})

	// Enable server reflection (allows grpcurl and other tools to discover services)
	reflection.Register(grpcServer)

	// Note: In production with generated protobuf code, register the service like:
	// pb.RegisterDeclarationServiceServer(grpcServer, &DeclarationGRPCServer{})
	// For now, the gRPC server provides health + reflection endpoints
	// The full service registration requires running protoc to generate Go bindings

	log.Printf("[declaration-service] gRPC server listening on :%s", grpcPort)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[gRPC] Server failed: %v", err)
	}
}

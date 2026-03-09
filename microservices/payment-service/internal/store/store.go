// store — PostgreSQL data access for payment-service
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// PaymentInvoice mirrors the payment_invoices table
type PaymentInvoice struct {
	ID                int64      `json:"id"`
	DeclarationId     int64      `json:"declarationId"`
	InvoiceNumber     string     `json:"invoiceNumber"`
	TraderId          int64      `json:"traderId"`
	DutyAmount        float64    `json:"dutyAmount"`
	VATAmount         float64    `json:"vatAmount"`
	LevyAmount        float64    `json:"levyAmount"`
	TotalAmount       float64    `json:"totalAmount"`
	Currency          string     `json:"currency"`
	Status            string     `json:"status"`
	MojaloopTxID      *string    `json:"mojaloopTxId,omitempty"`
	TigerBeetleTxID   *string    `json:"tigerBeetleTxId,omitempty"`
	PaymentMethod     *string    `json:"paymentMethod,omitempty"`
	PaidAt            *time.Time `json:"paidAt,omitempty"`
	DueDate           *time.Time `json:"dueDate,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// Store provides database access
type Store struct {
	db *sql.DB
}

// New creates a new Store
func New(dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// CreateInvoice creates a new payment invoice
func (s *Store) CreateInvoice(ctx context.Context, inv *PaymentInvoice) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO payment_invoices (declaration_id, invoice_number, trader_id,
		  duty_amount, vat_amount, levy_amount, total_amount, currency, status, due_date, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, NOW(), NOW())
		RETURNING id`,
		inv.DeclarationId, inv.InvoiceNumber, inv.TraderId,
		inv.DutyAmount, inv.VATAmount, inv.LevyAmount, inv.TotalAmount,
		inv.Currency, inv.DueDate,
	).Scan(&id)
	return id, err
}

// GetInvoice retrieves a payment invoice by ID
func (s *Store) GetInvoice(ctx context.Context, id int64) (*PaymentInvoice, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, declaration_id, invoice_number, trader_id, duty_amount, vat_amount,
		       levy_amount, total_amount, currency, status, mojaloop_tx_id, tigerbeetle_tx_id,
		       payment_method, paid_at, due_date, created_at, updated_at
		FROM payment_invoices WHERE id = $1`, id)

	inv := &PaymentInvoice{}
	err := row.Scan(
		&inv.ID, &inv.DeclarationId, &inv.InvoiceNumber, &inv.TraderId,
		&inv.DutyAmount, &inv.VATAmount, &inv.LevyAmount, &inv.TotalAmount,
		&inv.Currency, &inv.Status, &inv.MojaloopTxID, &inv.TigerBeetleTxID,
		&inv.PaymentMethod, &inv.PaidAt, &inv.DueDate, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return inv, err
}

// GetInvoicesByDeclaration retrieves all invoices for a declaration
func (s *Store) GetInvoicesByDeclaration(ctx context.Context, declarationId int64) ([]PaymentInvoice, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, declaration_id, invoice_number, trader_id, duty_amount, vat_amount,
		       levy_amount, total_amount, currency, status, mojaloop_tx_id, tigerbeetle_tx_id,
		       payment_method, paid_at, due_date, created_at, updated_at
		FROM payment_invoices WHERE declaration_id = $1 ORDER BY created_at`, declarationId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invoices []PaymentInvoice
	for rows.Next() {
		inv := PaymentInvoice{}
		err := rows.Scan(
			&inv.ID, &inv.DeclarationId, &inv.InvoiceNumber, &inv.TraderId,
			&inv.DutyAmount, &inv.VATAmount, &inv.LevyAmount, &inv.TotalAmount,
			&inv.Currency, &inv.Status, &inv.MojaloopTxID, &inv.TigerBeetleTxID,
			&inv.PaymentMethod, &inv.PaidAt, &inv.DueDate, &inv.CreatedAt, &inv.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		invoices = append(invoices, inv)
	}
	return invoices, rows.Err()
}

// UpdateInvoicePayment updates payment details after successful payment
func (s *Store) UpdateInvoicePayment(ctx context.Context, id int64, mojaloopTxID, tbTxID, method string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `
		UPDATE payment_invoices
		SET status = 'paid', mojaloop_tx_id = $1, tigerbeetle_tx_id = $2,
		    payment_method = $3, paid_at = $4, updated_at = NOW()
		WHERE id = $5`,
		mojaloopTxID, tbTxID, method, now, id)
	return err
}

// UpdateInvoiceStatus updates the status of an invoice
func (s *Store) UpdateInvoiceStatus(ctx context.Context, id int64, status string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE payment_invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
		status, id)
	return err
}

// GetInvoiceByMojaloopTxID retrieves an invoice by Mojaloop transaction ID
func (s *Store) GetInvoiceByMojaloopTxID(ctx context.Context, txID string) (*PaymentInvoice, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, declaration_id, invoice_number, trader_id, duty_amount, vat_amount,
		       levy_amount, total_amount, currency, status, mojaloop_tx_id, tigerbeetle_tx_id,
		       payment_method, paid_at, due_date, created_at, updated_at
		FROM payment_invoices WHERE mojaloop_tx_id = $1`, txID)

	inv := &PaymentInvoice{}
	err := row.Scan(
		&inv.ID, &inv.DeclarationId, &inv.InvoiceNumber, &inv.TraderId,
		&inv.DutyAmount, &inv.VATAmount, &inv.LevyAmount, &inv.TotalAmount,
		&inv.Currency, &inv.Status, &inv.MojaloopTxID, &inv.TigerBeetleTxID,
		&inv.PaymentMethod, &inv.PaidAt, &inv.DueDate, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return inv, err
}

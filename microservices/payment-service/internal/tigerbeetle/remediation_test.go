package tigerbeetle

import "testing"

// SW-M3: the in-memory mock must refuse construction in production.
func TestNewMockPanicsInProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	defer func() {
		if recover() == nil {
			t.Fatal("NewMock did not panic in production")
		}
	}()
	NewMock()
}

func TestNewMockAllowedInDev(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	if NewMock() == nil {
		t.Fatal("NewMock returned nil in dev")
	}
}

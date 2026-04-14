import { useState, useEffect, useCallback } from 'react';
import { trpcService } from '../services/trpcService';

export function useDeclarations() {
  const [declarations, setDeclarations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeclarations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await trpcService.declarations.list({ limit: 20, offset: 0 });
      setDeclarations(data.items);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDeclarations(); }, [fetchDeclarations]);

  return { declarations, loading, error, refetch: fetchDeclarations };
}

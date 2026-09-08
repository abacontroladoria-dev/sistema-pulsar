-- Recarrega o cache do PostgREST após migrations que introduzem objetos usados
-- diretamente pelo cliente Supabase.
notify pgrst, 'reload schema';
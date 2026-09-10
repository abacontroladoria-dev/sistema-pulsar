export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      acomp_auditoria: {
        Row: {
          bundle_id: string | null
          conflitos: number | null
          criadas: number | null
          criado_em: string
          csv_grade_id: string | null
          dados: Json | null
          dia: string | null
          evento: string
          hora: string | null
          id: number
          id_agenda_fav: number | null
          lote_id: string | null
          paciente: string
          profissional: string | null
          rejeitadas: number | null
          resultado: string | null
          status_bundle: string | null
          terapia: string | null
          unidade: string | null
          usuario_email: string | null
          usuario_id: string
        }
        Insert: {
          bundle_id?: string | null
          conflitos?: number | null
          criadas?: number | null
          criado_em?: string
          csv_grade_id?: string | null
          dados?: Json | null
          dia?: string | null
          evento: string
          hora?: string | null
          id?: never
          id_agenda_fav?: number | null
          lote_id?: string | null
          paciente: string
          profissional?: string | null
          rejeitadas?: number | null
          resultado?: string | null
          status_bundle?: string | null
          terapia?: string | null
          unidade?: string | null
          usuario_email?: string | null
          usuario_id?: string
        }
        Update: {
          bundle_id?: string | null
          conflitos?: number | null
          criadas?: number | null
          criado_em?: string
          csv_grade_id?: string | null
          dados?: Json | null
          dia?: string | null
          evento?: string
          hora?: string | null
          id?: never
          id_agenda_fav?: number | null
          lote_id?: string | null
          paciente?: string
          profissional?: string | null
          rejeitadas?: number | null
          resultado?: string | null
          status_bundle?: string | null
          terapia?: string | null
          unidade?: string | null
          usuario_email?: string | null
          usuario_id?: string
        }
        Relationships: []
      }
      acomp_conf: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          dados: Json
          id: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados: Json
          id: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados?: Json
          id?: string
        }
        Relationships: []
      }
      acomp_pac_bundles: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          dados: Json
          id: string
          pac: string
          status: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados: Json
          id: string
          pac: string
          status?: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados?: Json
          id?: string
          pac?: string
          status?: string
        }
        Relationships: []
      }
      acomp_prof_map: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          id: string
          status: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          id: string
          status: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          id?: string
          status?: string
        }
        Relationships: []
      }
      agenda_orbita: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          crm: string | null
          crm_formatado: string | null
          crm_numero: string | null
          crm_uf: string | null
          data_atendimento: string
          dep: string | null
          empresa: string | null
          horario: string
          id: string
          matricula: string | null
          nome_medico: string | null
          nome_medico_normalizado: string | null
          paciente_id: string
          paciente_nome: string
          terapia: string | null
          tuss: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          crm?: string | null
          crm_formatado?: string | null
          crm_numero?: string | null
          crm_uf?: string | null
          data_atendimento: string
          dep?: string | null
          empresa?: string | null
          horario: string
          id?: string
          matricula?: string | null
          nome_medico?: string | null
          nome_medico_normalizado?: string | null
          paciente_id: string
          paciente_nome: string
          terapia?: string | null
          tuss?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          crm?: string | null
          crm_formatado?: string | null
          crm_numero?: string | null
          crm_uf?: string | null
          data_atendimento?: string
          dep?: string | null
          empresa?: string | null
          horario?: string
          id?: string
          matricula?: string | null
          nome_medico?: string | null
          nome_medico_normalizado?: string | null
          paciente_id?: string
          paciente_nome?: string
          terapia?: string | null
          tuss?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agenda_terapias: {
        Row: {
          created_at: string | null
          crm: string | null
          data_atendimento: string
          dep: string | null
          empresa: string | null
          horario: string
          id: string
          matricula: string | null
          nome_medico: string | null
          paciente_id: string
          paciente_nome: string
          terapia: string | null
          tuss: string | null
        }
        Insert: {
          created_at?: string | null
          crm?: string | null
          data_atendimento: string
          dep?: string | null
          empresa?: string | null
          horario: string
          id?: string
          matricula?: string | null
          nome_medico?: string | null
          paciente_id: string
          paciente_nome: string
          terapia?: string | null
          tuss?: string | null
        }
        Update: {
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string
          dep?: string | null
          empresa?: string | null
          horario?: string
          id?: string
          matricula?: string | null
          nome_medico?: string | null
          paciente_id?: string
          paciente_nome?: string
          terapia?: string | null
          tuss?: string | null
        }
        Relationships: []
      }
      agenda_tita: {
        Row: {
          atividade: string | null
          ativo: boolean | null
          clinica_id: number | null
          clinica_nome: string | null
          convenio_id: number | null
          convenio_nome: string | null
          cpf: string | null
          created_at: string | null
          data_atendimento: string | null
          data_nascimento: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number
          motivo_inativacao: string | null
          numero_carteirinha: string | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          raw_json: Json | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number
          updated_at: string | null
        }
        Insert: {
          atividade?: string | null
          ativo?: boolean | null
          clinica_id?: number | null
          clinica_nome?: string | null
          convenio_id?: number | null
          convenio_nome?: string | null
          cpf?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_nascimento?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          motivo_inativacao?: string | null
          numero_carteirinha?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          raw_json?: Json | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id: number
          updated_at?: string | null
        }
        Update: {
          atividade?: string | null
          ativo?: boolean | null
          clinica_id?: number | null
          clinica_nome?: string | null
          convenio_id?: number | null
          convenio_nome?: string | null
          cpf?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_nascimento?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          motivo_inativacao?: string | null
          numero_carteirinha?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          raw_json?: Json | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      agenda_tita_autorizacao_backup_20260508: {
        Row: {
          atividade: string | null
          ativo: boolean | null
          clinica_id: number | null
          clinica_nome: string | null
          codigo_tuss: string | null
          convenio_id: number | null
          convenio_nome: string | null
          cpf: string | null
          created_at: string | null
          crm: string | null
          data_atendimento: string | null
          dep: string | null
          empresa: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number | null
          matricula: string | null
          nome_medico: string | null
          numero_carteirinha: string | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          raw_json: Json | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          updated_at: string | null
        }
        Insert: {
          atividade?: string | null
          ativo?: boolean | null
          clinica_id?: number | null
          clinica_nome?: string | null
          codigo_tuss?: string | null
          convenio_id?: number | null
          convenio_nome?: string | null
          cpf?: string | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          dep?: string | null
          empresa?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number | null
          matricula?: string | null
          nome_medico?: string | null
          numero_carteirinha?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          raw_json?: Json | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Update: {
          atividade?: string | null
          ativo?: boolean | null
          clinica_id?: number | null
          clinica_nome?: string | null
          codigo_tuss?: string | null
          convenio_id?: number | null
          convenio_nome?: string | null
          cpf?: string | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          dep?: string | null
          empresa?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number | null
          matricula?: string | null
          nome_medico?: string | null
          numero_carteirinha?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          raw_json?: Json | null
          responsavel_email?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      alertas: {
        Row: {
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          descricao: string | null
          entidade_id: string
          entidade_ref: Json
          entidade_tipo: string
          fingerprint: string
          id: string
          modulo: string
          origem: string
          prioridade: string
          regra_codigo: string | null
          resolucao: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          responsavel_id: string | null
          setor_destino: string | null
          status: string
          titulo: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          entidade_id: string
          entidade_ref?: Json
          entidade_tipo: string
          fingerprint: string
          id?: string
          modulo: string
          origem: string
          prioridade?: string
          regra_codigo?: string | null
          resolucao?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          responsavel_id?: string | null
          setor_destino?: string | null
          status?: string
          titulo: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          entidade_id?: string
          entidade_ref?: Json
          entidade_tipo?: string
          fingerprint?: string
          id?: string
          modulo?: string
          origem?: string
          prioridade?: string
          regra_codigo?: string | null
          resolucao?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          responsavel_id?: string | null
          setor_destino?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_regra_codigo_fkey"
            columns: ["regra_codigo"]
            isOneToOne: false
            referencedRelation: "alertas_regras"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "alertas_resolvido_por_fkey"
            columns: ["resolvido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas_eventos: {
        Row: {
          alerta_id: string | null
          autor_id: string | null
          autor_nome: string | null
          autor_tipo: string
          criado_em: string
          descricao: string
          entidade_id: string
          entidade_tipo: string
          id: number
          metadata: Json
          tipo: string
        }
        Insert: {
          alerta_id?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          autor_tipo: string
          criado_em?: string
          descricao: string
          entidade_id: string
          entidade_tipo: string
          id?: number
          metadata?: Json
          tipo: string
        }
        Update: {
          alerta_id?: string | null
          autor_id?: string | null
          autor_nome?: string | null
          autor_tipo?: string
          criado_em?: string
          descricao?: string
          entidade_id?: string
          entidade_tipo?: string
          id?: number
          metadata?: Json
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_eventos_alerta_id_fkey"
            columns: ["alerta_id"]
            isOneToOne: false
            referencedRelation: "alertas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_eventos_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas_regras: {
        Row: {
          ativo: boolean
          atualizado_em: string
          codigo: string
          criado_em: string
          modulo: string
          nome: string
          prioridade: string
          setor_destino: string | null
          tolerancia_minutos: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          codigo: string
          criado_em?: string
          modulo: string
          nome: string
          prioridade?: string
          setor_destino?: string | null
          tolerancia_minutos: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          codigo?: string
          criado_em?: string
          modulo?: string
          nome?: string
          prioridade?: string
          setor_destino?: string | null
          tolerancia_minutos?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          error_message: string | null
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          status: string
          table_name: string
          timestamp: string
          user_agent: string | null
          user_email: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          status?: string
          table_name: string
          timestamp?: string
          user_agent?: string | null
          user_email: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          status?: string
          table_name?: string
          timestamp?: string
          user_agent?: string | null
          user_email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      auditoria_glosa_motivos: {
        Row: {
          atualizado_em: string | null
          bloco_id: string
          motivo_glosa: string
        }
        Insert: {
          atualizado_em?: string | null
          bloco_id: string
          motivo_glosa: string
        }
        Update: {
          atualizado_em?: string | null
          bloco_id?: string
          motivo_glosa?: string
        }
        Relationships: []
      }
      autorizacoes: {
        Row: {
          created_at: string | null
          crm: string | null
          data_atendimento: string | null
          data_horario: string | null
          dep: string | null
          empresa: string | null
          erro: string | null
          erro_detalhe: string | null
          finished_at: string | null
          horario: string | null
          horario_atendimento: string | null
          id: string
          log: Json | null
          machine_id: string | null
          matricula: string | null
          nome_medico: string | null
          orbita_agenda_id: string | null
          paciente_id: string | null
          paciente_nome: string | null
          started_at: string | null
          status: string | null
          terapia: string | null
          tuss1: string | null
          ultima_autorizacao: string | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          erro?: string | null
          erro_detalhe?: string | null
          finished_at?: string | null
          horario?: string | null
          horario_atendimento?: string | null
          id?: string
          log?: Json | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          orbita_agenda_id?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          started_at?: string | null
          status?: string | null
          terapia?: string | null
          tuss1?: string | null
          ultima_autorizacao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          erro?: string | null
          erro_detalhe?: string | null
          finished_at?: string | null
          horario?: string | null
          horario_atendimento?: string | null
          id?: string
          log?: Json | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          orbita_agenda_id?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          started_at?: string | null
          status?: string | null
          terapia?: string | null
          tuss1?: string | null
          ultima_autorizacao?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autorizacoes_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
        ]
      }
      autorizacoes_assim: {
        Row: {
          biofacial: string | null
          codigo_erro: string | null
          codigo_tuss: string | null
          data_autorizacao: string | null
          data_execucao: string | null
          descricao_erro: string | null
          guia: string
          matricula: string | null
          matricula_limpa: string | null
          paciente_id: number | null
          paciente_nome: string | null
          status: string | null
          status_tratado: string | null
          teve_token: boolean | null
          token: string | null
          updated_at: string | null
        }
        Insert: {
          biofacial?: string | null
          codigo_erro?: string | null
          codigo_tuss?: string | null
          data_autorizacao?: string | null
          data_execucao?: string | null
          descricao_erro?: string | null
          guia: string
          matricula?: string | null
          matricula_limpa?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          status?: string | null
          status_tratado?: string | null
          teve_token?: boolean | null
          token?: string | null
          updated_at?: string | null
        }
        Update: {
          biofacial?: string | null
          codigo_erro?: string | null
          codigo_tuss?: string | null
          data_autorizacao?: string | null
          data_execucao?: string | null
          descricao_erro?: string | null
          guia?: string
          matricula?: string | null
          matricula_limpa?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          status?: string | null
          status_tratado?: string | null
          teve_token?: boolean | null
          token?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      backup_fila_null_terapia: {
        Row: {
          agenda_id: string | null
          assim_updated_at: string | null
          completed_at: string | null
          completed_by: string | null
          completion_type: string | null
          created_at: string | null
          criado_por: string | null
          crm: string | null
          data_atendimento: string | null
          data_horario: string | null
          dep: string | null
          empresa: string | null
          error_message: string | null
          execution_time_ms: number | null
          horario: string | null
          horario_autorizacao: string | null
          id: string | null
          machine_id: string | null
          matricula: string | null
          nome_medico: string | null
          numero_autorizacao: string | null
          paciente_id: string | null
          paciente_nome: string | null
          started_at: string | null
          status: string | null
          status_assim: string | null
          terapia_exibicao_id: number | null
          terapia_falta: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          tuss: string | null
          tuss1: string | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_type?: string | null
          created_at?: string | null
          criado_por?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          horario?: string | null
          horario_autorizacao?: string | null
          id?: string | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          numero_autorizacao?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          started_at?: string | null
          status?: string | null
          status_assim?: string | null
          terapia_exibicao_id?: number | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tuss?: string | null
          tuss1?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_type?: string | null
          created_at?: string | null
          criado_por?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          horario?: string | null
          horario_autorizacao?: string | null
          id?: string | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          numero_autorizacao?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          started_at?: string | null
          status?: string | null
          status_assim?: string | null
          terapia_exibicao_id?: number | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tuss?: string | null
          tuss1?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      chamada_paciente: {
        Row: {
          agenda_id: string | null
          chamado_em: string | null
          chamado_por: string | null
          id: string
          nome: string
          sala: string | null
          status: string | null
          unidade: string | null
        }
        Insert: {
          agenda_id?: string | null
          chamado_em?: string | null
          chamado_por?: string | null
          id?: string
          nome: string
          sala?: string | null
          status?: string | null
          unidade?: string | null
        }
        Update: {
          agenda_id?: string | null
          chamado_em?: string | null
          chamado_por?: string | null
          id?: string
          nome?: string
          sala?: string | null
          status?: string | null
          unidade?: string | null
        }
        Relationships: []
      }
      config_regras_terapias: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          descricao: string | null
          id: number
          terapia_nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria: string
          created_at?: string
          descricao?: string | null
          id?: number
          terapia_nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          descricao?: string | null
          id?: number
          terapia_nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      controle_disponibilidade_terapeutas: {
        Row: {
          agenda_id: number | null
          created_at: string
          criado_por: string | null
          data: string
          hora_final: string | null
          hora_inicial: string
          id: string
          motivo: string | null
          observacao: string | null
          possui_substituto: boolean
          status: string
          substituto_id: number | null
          substituto_nome: string | null
          terapeuta_id: number
          terapeuta_nome: string
          terapia_id: number | null
          terapia_nome: string | null
          updated_at: string
        }
        Insert: {
          agenda_id?: number | null
          created_at?: string
          criado_por?: string | null
          data: string
          hora_final?: string | null
          hora_inicial: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          possui_substituto?: boolean
          status?: string
          substituto_id?: number | null
          substituto_nome?: string | null
          terapeuta_id: number
          terapeuta_nome: string
          terapia_id?: number | null
          terapia_nome?: string | null
          updated_at?: string
        }
        Update: {
          agenda_id?: number | null
          created_at?: string
          criado_por?: string | null
          data?: string
          hora_final?: string | null
          hora_inicial?: string
          id?: string
          motivo?: string | null
          observacao?: string | null
          possui_substituto?: boolean
          status?: string
          substituto_id?: number | null
          substituto_nome?: string | null
          terapeuta_id?: number
          terapeuta_nome?: string
          terapia_id?: number | null
          terapia_nome?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      controle_terapeutico: {
        Row: {
          confirmado_em: string | null
          confirmado_por: string | null
          confirmado_por_nome: string | null
          created_at: string | null
          data_atendimento: string | null
          data_atualizacao: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: string
          observacao: string | null
          profissional_id: number | null
          profissional_nome: string | null
          profissional_substituto_id: number | null
          profissional_substituto_nome: string | null
          status: string
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number
          updated_at: string | null
        }
        Insert: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          confirmado_por_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_atualizacao?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string
          observacao?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          profissional_substituto_id?: number | null
          profissional_substituto_nome?: string | null
          status?: string
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id: number
          updated_at?: string | null
        }
        Update: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          confirmado_por_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_atualizacao?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string
          observacao?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          profissional_substituto_id?: number | null
          profissional_substituto_nome?: string | null
          status?: string
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_inconsistencias: {
        Row: {
          created_at: string | null
          crm_numero: string | null
          id: string
          nome_medico_normalizado: string | null
          ocorrencias: number | null
        }
        Insert: {
          created_at?: string | null
          crm_numero?: string | null
          id?: string
          nome_medico_normalizado?: string | null
          ocorrencias?: number | null
        }
        Update: {
          created_at?: string | null
          crm_numero?: string | null
          id?: string
          nome_medico_normalizado?: string | null
          ocorrencias?: number | null
        }
        Relationships: []
      }
      cronograma_convenio_pacote_avaliacao: {
        Row: {
          convenio_nome: string
          created_at: string
          id: string
          observacoes: string | null
          terapia_id: number
          terapia_nome: string
          updated_at: string
          valor_a_vista: number
          valor_parcelado: number | null
        }
        Insert: {
          convenio_nome: string
          created_at?: string
          id?: string
          observacoes?: string | null
          terapia_id: number
          terapia_nome: string
          updated_at?: string
          valor_a_vista: number
          valor_parcelado?: number | null
        }
        Update: {
          convenio_nome?: string
          created_at?: string
          id?: string
          observacoes?: string | null
          terapia_id?: number
          terapia_nome?: string
          updated_at?: string
          valor_a_vista?: number
          valor_parcelado?: number | null
        }
        Relationships: []
      }
      cronograma_convenio_valores: {
        Row: {
          convenio_nome: string
          created_at: string
          criterio_aba: string | null
          id: string
          observacoes: string | null
          terapia_id: number | null
          terapia_nome: string | null
          updated_at: string
          valor_sessao: number | null
        }
        Insert: {
          convenio_nome: string
          created_at?: string
          criterio_aba?: string | null
          id?: string
          observacoes?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          updated_at?: string
          valor_sessao?: number | null
        }
        Update: {
          convenio_nome?: string
          created_at?: string
          criterio_aba?: string | null
          id?: string
          observacoes?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          updated_at?: string
          valor_sessao?: number | null
        }
        Relationships: []
      }
      cronograma_convenio_valores_paciente: {
        Row: {
          convenio_nome: string
          created_at: string
          id: string
          observacoes: string | null
          paciente_id: number | null
          paciente_nome: string
          updated_at: string
          valor_sessao: number | null
        }
        Insert: {
          convenio_nome: string
          created_at?: string
          id?: string
          observacoes?: string | null
          paciente_id?: number | null
          paciente_nome: string
          updated_at?: string
          valor_sessao?: number | null
        }
        Update: {
          convenio_nome?: string
          created_at?: string
          id?: string
          observacoes?: string | null
          paciente_id?: number | null
          paciente_nome?: string
          updated_at?: string
          valor_sessao?: number | null
        }
        Relationships: []
      }
      cronograma_nucleos: {
        Row: {
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      cronograma_salas: {
        Row: {
          andar: string | null
          capacidade: string
          created_at: string
          id: string
          nome_exibicao: string
          nucleo: string | null
          numero_sala: string
          observacoes: string | null
          sala_nome_referencia: string | null
          status: string
          unidade_nome: string
          updated_at: string
        }
        Insert: {
          andar?: string | null
          capacidade: string
          created_at?: string
          id?: string
          nome_exibicao: string
          nucleo?: string | null
          numero_sala: string
          observacoes?: string | null
          sala_nome_referencia?: string | null
          status?: string
          unidade_nome: string
          updated_at?: string
        }
        Update: {
          andar?: string | null
          capacidade?: string
          created_at?: string
          id?: string
          nome_exibicao?: string
          nucleo?: string | null
          numero_sala?: string
          observacoes?: string | null
          sala_nome_referencia?: string | null
          status?: string
          unidade_nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_cronograma_salas_nucleo"
            columns: ["nucleo"]
            isOneToOne: false
            referencedRelation: "cronograma_nucleos"
            referencedColumns: ["nome"]
          },
        ]
      }
      cronograma_salas_alocacoes: {
        Row: {
          created_at: string
          created_by: string | null
          dow: number
          id: string
          profissional_id: number | null
          profissional_nome: string
          sala_id: string
          terapia_id: number | null
          terapia_nome: string | null
          turno: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dow: number
          id?: string
          profissional_id?: number | null
          profissional_nome: string
          sala_id: string
          terapia_id?: number | null
          terapia_nome?: string | null
          turno: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dow?: number
          id?: string
          profissional_id?: number | null
          profissional_nome?: string
          sala_id?: string
          terapia_id?: number | null
          terapia_nome?: string | null
          turno?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cronograma_salas_alocacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "cronograma_salas"
            referencedColumns: ["id"]
          },
        ]
      }
      cronograma_salas_auditoria: {
        Row: {
          acao: string
          antes: Json | null
          criado_em: string
          criado_em_brasilia: string | null
          depois: Json | null
          dia_semana: number | null
          id: string
          motivo: string | null
          nucleo_nome: string | null
          profissional_nome: string | null
          registro_id: string
          resumo: string | null
          sala_nome: string | null
          tabela: string
          terapia_nome: string | null
          turno: string | null
          unidade_nome: string | null
          usuario_id: string | null
          usuario_nome: string | null
        }
        Insert: {
          acao: string
          antes?: Json | null
          criado_em?: string
          criado_em_brasilia?: string | null
          depois?: Json | null
          dia_semana?: number | null
          id?: string
          motivo?: string | null
          nucleo_nome?: string | null
          profissional_nome?: string | null
          registro_id: string
          resumo?: string | null
          sala_nome?: string | null
          tabela: string
          terapia_nome?: string | null
          turno?: string | null
          unidade_nome?: string | null
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Update: {
          acao?: string
          antes?: Json | null
          criado_em?: string
          criado_em_brasilia?: string | null
          depois?: Json | null
          dia_semana?: number | null
          id?: string
          motivo?: string | null
          nucleo_nome?: string | null
          profissional_nome?: string | null
          registro_id?: string
          resumo?: string | null
          sala_nome?: string | null
          tabela?: string
          terapia_nome?: string | null
          turno?: string | null
          unidade_nome?: string | null
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cronograma_ocupacao_trilha_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cronograma_salas_terapias_exclusivas: {
        Row: {
          created_at: string
          id: string
          modo: string
          sala_id: string
          terapia_id: number
          terapia_nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          modo: string
          sala_id: string
          terapia_id: number
          terapia_nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          modo?: string
          sala_id?: string
          terapia_id?: number
          terapia_nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cronograma_salas_terapias_exclusivas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "cronograma_salas"
            referencedColumns: ["id"]
          },
        ]
      }
      cronograma_status_labels: {
        Row: {
          codigo: string
          label: string
          label_curto: string
          tone: string
          updated_at: string
        }
        Insert: {
          codigo: string
          label: string
          label_curto: string
          tone?: string
          updated_at?: string
        }
        Update: {
          codigo?: string
          label?: string
          label_curto?: string
          tone?: string
          updated_at?: string
        }
        Relationships: []
      }
      csv_grades_profissionais: {
        Row: {
          ativo: boolean
          ausencia_confirmada_em: string | null
          convenio_nome: string | null
          criado_em_tita: string | null
          data: string
          descricao_evolucao: string | null
          dia_semana: string | null
          evolucao_vinculo: string | null
          excluido_em_tita: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: string
          inativado_em: string | null
          justificativa: string | null
          motivo_inativacao: string | null
          origem: string
          paciente_id: number | null
          paciente_nome: string | null
          possui_tratativa: boolean | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          status_agendamento: string | null
          status_execucao: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          tratativa_criada_em: string | null
          tratativa_origem: string | null
          tratativa_profissional_id: number | null
          tratativa_profissional_nome: string | null
          tratativas: number | null
          tratativas_distintas: number | null
          unidade_id: number | null
          unidade_nome: string | null
          updated_at: string | null
          visto_em: string | null
        }
        Insert: {
          ativo?: boolean
          ausencia_confirmada_em?: string | null
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data: string
          descricao_evolucao?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string
          inativado_em?: string | null
          justificativa?: string | null
          motivo_inativacao?: string | null
          origem?: string
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          tratativas?: number | null
          tratativas_distintas?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
          visto_em?: string | null
        }
        Update: {
          ativo?: boolean
          ausencia_confirmada_em?: string | null
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data?: string
          descricao_evolucao?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string
          inativado_em?: string | null
          justificativa?: string | null
          motivo_inativacao?: string | null
          origem?: string
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          tratativas?: number | null
          tratativas_distintas?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
          visto_em?: string | null
        }
        Relationships: []
      }
      csv_reposicao_faltas: {
        Row: {
          convenio_nome: string | null
          data: string
          dia_semana: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          status_agendamento: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          unidade_id: number | null
          unidade_nome: string | null
          updated_at: string | null
        }
        Insert: {
          convenio_nome?: string | null
          data: string
          dia_semana?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
        }
        Update: {
          convenio_nome?: string | null
          data?: string
          dia_semana?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dashboard_kpis_cache: {
        Row: {
          fazendinha: number
          metric_type: string
          padre_miguel: number
          realengo: number
          refreshed_at: string
          total: number
        }
        Insert: {
          fazendinha?: number
          metric_type: string
          padre_miguel?: number
          realengo?: number
          refreshed_at?: string
          total?: number
        }
        Update: {
          fazendinha?: number
          metric_type?: string
          padre_miguel?: number
          realengo?: number
          refreshed_at?: string
          total?: number
        }
        Relationships: []
      }
      edge_rate_limits: {
        Row: {
          bucket: string
          created_at: string
          id: number
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      "EM DESUSO - remuneracao_contratos_antigos": {
        Row: {
          ch_semanal: number
          contrato: string | null
          created_at: string
          id: string
          profissional_nome: string
          salario: number
          updated_at: string
        }
        Insert: {
          ch_semanal?: number
          contrato?: string | null
          created_at?: string
          id?: string
          profissional_nome: string
          salario?: number
          updated_at?: string
        }
        Update: {
          ch_semanal?: number
          contrato?: string | null
          created_at?: string
          id?: string
          profissional_nome?: string
          salario?: number
          updated_at?: string
        }
        Relationships: []
      }
      "EM DESUSO - remuneracao_contratos_atuais": {
        Row: {
          cnpj: string | null
          contratos_atuais: Json
          cpf: string | null
          created_at: string
          documento_tipo: string | null
          id: string
          observacoes: string | null
          profissional_nome: string
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          contratos_atuais?: Json
          cpf?: string | null
          created_at?: string
          documento_tipo?: string | null
          id?: string
          observacoes?: string | null
          profissional_nome: string
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          contratos_atuais?: Json
          cpf?: string | null
          created_at?: string
          documento_tipo?: string | null
          id?: string
          observacoes?: string | null
          profissional_nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      feriados: {
        Row: {
          created_at: string
          data: string
          horario_fim: string
          horario_inicio: string
          id: string
          nome: string
          tipo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          data: string
          horario_fim: string
          horario_inicio: string
          id?: string
          nome: string
          tipo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          data?: string
          horario_fim?: string
          horario_inicio?: string
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feriados_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      fila_autorizacoes: {
        Row: {
          agenda_id: string | null
          assim_updated_at: string | null
          cancelado_em: string | null
          cancelado_por_nome: string | null
          completed_at: string | null
          completed_by: string | null
          completion_type: string | null
          created_at: string | null
          criado_por: string | null
          crm: string | null
          crm_uf: string | null
          data_atendimento: string
          data_horario: string | null
          dep: string | null
          empresa: string | null
          error_message: string | null
          execution_time_ms: number | null
          falta_revertida_em: string | null
          falta_revertida_por_nome: string | null
          forma_autorizacao: string | null
          horario: string
          horario_autorizacao: string | null
          id: string
          justificativa_falta: string | null
          machine_id: string | null
          matricula: string | null
          nome_medico: string | null
          numero_autorizacao: string | null
          paciente_id: string
          paciente_nome: string
          started_at: string | null
          status: string
          status_assim: string | null
          terapia_exibicao_id: number | null
          terapia_falta: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          tita_agendamento_id: number | null
          tuss: string | null
          tuss1: string | null
          updated_at: string | null
          usuario_id: string | null
          validacao_finalizada_em: string | null
        }
        Insert: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          cancelado_em?: string | null
          cancelado_por_nome?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_type?: string | null
          created_at?: string | null
          criado_por?: string | null
          crm?: string | null
          crm_uf?: string | null
          data_atendimento: string
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          falta_revertida_em?: string | null
          falta_revertida_por_nome?: string | null
          forma_autorizacao?: string | null
          horario: string
          horario_autorizacao?: string | null
          id?: string
          justificativa_falta?: string | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          numero_autorizacao?: string | null
          paciente_id: string
          paciente_nome: string
          started_at?: string | null
          status?: string
          status_assim?: string | null
          terapia_exibicao_id?: number | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tita_agendamento_id?: number | null
          tuss?: string | null
          tuss1?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          validacao_finalizada_em?: string | null
        }
        Update: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          cancelado_em?: string | null
          cancelado_por_nome?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_type?: string | null
          created_at?: string | null
          criado_por?: string | null
          crm?: string | null
          crm_uf?: string | null
          data_atendimento?: string
          data_horario?: string | null
          dep?: string | null
          empresa?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          falta_revertida_em?: string | null
          falta_revertida_por_nome?: string | null
          forma_autorizacao?: string | null
          horario?: string
          horario_autorizacao?: string | null
          id?: string
          justificativa_falta?: string | null
          machine_id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          numero_autorizacao?: string | null
          paciente_id?: string
          paciente_nome?: string
          started_at?: string | null
          status?: string
          status_assim?: string | null
          terapia_exibicao_id?: number | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tita_agendamento_id?: number | null
          tuss?: string | null
          tuss1?: string | null
          updated_at?: string | null
          usuario_id?: string | null
          validacao_finalizada_em?: string | null
        }
        Relationships: []
      }
      fila_autorizacoes_backup_titaid: {
        Row: {
          id: string | null
          tita_agendamento_id: number | null
        }
        Insert: {
          id?: string | null
          tita_agendamento_id?: number | null
        }
        Update: {
          id?: string | null
          tita_agendamento_id?: number | null
        }
        Relationships: []
      }
      fila_autorizacoes_logs: {
        Row: {
          created_at: string | null
          descricao: string | null
          erro: string | null
          fila_id: string
          horario_autorizacao: string | null
          id: string
          machine_id: string | null
          metadata: Json | null
          numero_autorizacao: string | null
          status: string | null
          tita_agendamento_id: number | null
          usuario: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          erro?: string | null
          fila_id: string
          horario_autorizacao?: string | null
          id?: string
          machine_id?: string | null
          metadata?: Json | null
          numero_autorizacao?: string | null
          status?: string | null
          tita_agendamento_id?: number | null
          usuario?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          erro?: string | null
          fila_id?: string
          horario_autorizacao?: string | null
          id?: string
          machine_id?: string | null
          metadata?: Json | null
          numero_autorizacao?: string | null
          status?: string | null
          tita_agendamento_id?: number | null
          usuario?: string | null
        }
        Relationships: []
      }
      fila_bkp_titaid_faltas_jun: {
        Row: {
          id: string | null
          tita_agendamento_id: number | null
        }
        Insert: {
          id?: string | null
          tita_agendamento_id?: number | null
        }
        Update: {
          id?: string | null
          tita_agendamento_id?: number | null
        }
        Relationships: []
      }
      grade_profissionais_tita: {
        Row: {
          cbo_profissional: string | null
          convenio_nome: string | null
          cpf_profissional: string | null
          created_at: string | null
          data: string
          dia_semana: string | null
          grade_clinica_id: number | null
          grade_terapeuta_id: number
          hora_final: string
          hora_inicial: string
          id: string
          id_sala: number | null
          id_unidade: number | null
          nome_profissional: string | null
          nome_terapia: string | null
          nome_unidade: string | null
          numero_telefone: string | null
          observacoes_sala: string | null
          paciente_nome: string | null
          profissional_id: number | null
          raw_json: Json | null
          registro_profissional: string | null
          sala: string | null
          status_agendamento: string | null
          terapia_exibicao: string | null
          terapia_exibicao_id: number | null
          terapia_id: number | null
          tipo_registro_profissional: string | null
          uf_registro_profissional: string | null
          updated_at: string | null
        }
        Insert: {
          cbo_profissional?: string | null
          convenio_nome?: string | null
          cpf_profissional?: string | null
          created_at?: string | null
          data: string
          dia_semana?: string | null
          grade_clinica_id?: number | null
          grade_terapeuta_id: number
          hora_final: string
          hora_inicial: string
          id?: string
          id_sala?: number | null
          id_unidade?: number | null
          nome_profissional?: string | null
          nome_terapia?: string | null
          nome_unidade?: string | null
          numero_telefone?: string | null
          observacoes_sala?: string | null
          paciente_nome?: string | null
          profissional_id?: number | null
          raw_json?: Json | null
          registro_profissional?: string | null
          sala?: string | null
          status_agendamento?: string | null
          terapia_exibicao?: string | null
          terapia_exibicao_id?: number | null
          terapia_id?: number | null
          tipo_registro_profissional?: string | null
          uf_registro_profissional?: string | null
          updated_at?: string | null
        }
        Update: {
          cbo_profissional?: string | null
          convenio_nome?: string | null
          cpf_profissional?: string | null
          created_at?: string | null
          data?: string
          dia_semana?: string | null
          grade_clinica_id?: number | null
          grade_terapeuta_id?: number
          hora_final?: string
          hora_inicial?: string
          id?: string
          id_sala?: number | null
          id_unidade?: number | null
          nome_profissional?: string | null
          nome_terapia?: string | null
          nome_unidade?: string | null
          numero_telefone?: string | null
          observacoes_sala?: string | null
          paciente_nome?: string | null
          profissional_id?: number | null
          raw_json?: Json | null
          registro_profissional?: string | null
          sala?: string | null
          status_agendamento?: string | null
          terapia_exibicao?: string | null
          terapia_exibicao_id?: number | null
          terapia_id?: number | null
          tipo_registro_profissional?: string | null
          uf_registro_profissional?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      guia_terapias: {
        Row: {
          created_at: string | null
          guia_numero: string
          id: string
          terapeuta_id: string | null
          terapia_nome: string
        }
        Insert: {
          created_at?: string | null
          guia_numero: string
          id?: string
          terapeuta_id?: string | null
          terapia_nome: string
        }
        Update: {
          created_at?: string | null
          guia_numero?: string
          id?: string
          terapeuta_id?: string | null
          terapia_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "guia_terapias_terapeuta_id_fkey"
            columns: ["terapeuta_id"]
            isOneToOne: false
            referencedRelation: "terapeutas"
            referencedColumns: ["id"]
          },
        ]
      }
      guias_processadas: {
        Row: {
          created_at: string | null
          guia_numero: string | null
          id: string
          metadata: Json | null
          page_count: number
          status: string
        }
        Insert: {
          created_at?: string | null
          guia_numero?: string | null
          id?: string
          metadata?: Json | null
          page_count?: number
          status?: string
        }
        Update: {
          created_at?: string | null
          guia_numero?: string | null
          id?: string
          metadata?: Json | null
          page_count?: number
          status?: string
        }
        Relationships: []
      }
      logs: {
        Row: {
          autorizacao_id: string | null
          created_at: string | null
          fila_id: string | null
          id: string
          mensagem: string | null
          nivel: string | null
          origem: string | null
        }
        Insert: {
          autorizacao_id?: string | null
          created_at?: string | null
          fila_id?: string | null
          id?: string
          mensagem?: string | null
          nivel?: string | null
          origem?: string | null
        }
        Update: {
          autorizacao_id?: string | null
          created_at?: string | null
          fila_id?: string | null
          id?: string
          mensagem?: string | null
          nivel?: string | null
          origem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_autorizacao_id_fkey"
            columns: ["autorizacao_id"]
            isOneToOne: false
            referencedRelation: "autorizacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_execucao: {
        Row: {
          created_at: string | null
          id: string
          machine_id: string | null
          mensagem: string | null
          payload: Json | null
          session_id: string | null
          status: string | null
          tipo_acao: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          machine_id?: string | null
          mensagem?: string | null
          payload?: Json | null
          session_id?: string | null
          status?: string | null
          tipo_acao?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          machine_id?: string | null
          mensagem?: string | null
          payload?: Json | null
          session_id?: string | null
          status?: string | null
          tipo_acao?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_execucao_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      maquinas: {
        Row: {
          ativa: boolean | null
          created_at: string | null
          hostname: string | null
          id: string
          ip: string | null
          last_seen: string | null
          navegador: string | null
          nome: string | null
          restart_solicitado: boolean
          sistema_operacional: string | null
          token_maquina: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ativa?: boolean | null
          created_at?: string | null
          hostname?: string | null
          id: string
          ip?: string | null
          last_seen?: string | null
          navegador?: string | null
          nome?: string | null
          restart_solicitado?: boolean
          sistema_operacional?: string | null
          token_maquina?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ativa?: boolean | null
          created_at?: string | null
          hostname?: string | null
          id?: string
          ip?: string | null
          last_seen?: string | null
          navegador?: string | null
          nome?: string | null
          restart_solicitado?: boolean
          sistema_operacional?: string | null
          token_maquina?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      paciente_classificacao: {
        Row: {
          convenio_tipo: string | null
          created_at: string | null
          id: string
          paciente_id: string | null
          paciente_nome: string | null
          updated_at: string | null
        }
        Insert: {
          convenio_tipo?: string | null
          created_at?: string | null
          id?: string
          paciente_id?: string | null
          paciente_nome?: string | null
          updated_at?: string | null
        }
        Update: {
          convenio_tipo?: string | null
          created_at?: string | null
          id?: string
          paciente_id?: string | null
          paciente_nome?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      paciente_medico_vigente: {
        Row: {
          crm_formatado: string | null
          crm_numero: string | null
          crm_original: string | null
          crm_suspeito: boolean | null
          crm_uf: string | null
          nome_medico: string | null
          nome_medico_normalizado: string | null
          origem: string | null
          paciente_id: string
          updated_at: string | null
          vigente_desde: string | null
        }
        Insert: {
          crm_formatado?: string | null
          crm_numero?: string | null
          crm_original?: string | null
          crm_suspeito?: boolean | null
          crm_uf?: string | null
          nome_medico?: string | null
          nome_medico_normalizado?: string | null
          origem?: string | null
          paciente_id: string
          updated_at?: string | null
          vigente_desde?: string | null
        }
        Update: {
          crm_formatado?: string | null
          crm_numero?: string | null
          crm_original?: string | null
          crm_suspeito?: boolean | null
          crm_uf?: string | null
          nome_medico?: string | null
          nome_medico_normalizado?: string | null
          origem?: string | null
          paciente_id?: string
          updated_at?: string | null
          vigente_desde?: string | null
        }
        Relationships: []
      }
      pep_apuracao_mensal: {
        Row: {
          ajuste_recorrentes: Json
          ajuste_recorrentes_valor: number
          ajuste_semestrais: Json
          ajuste_semestrais_valor: number
          calculado_em: string
          calculado_por: string | null
          competencia: string
          devolucao_valor: number
          estado: string
          id: string
          liberado_em: string | null
          liberado_por: string | null
          modo_teste: boolean
          paciente_cpf: string | null
          paciente_nome: string
          prestador_nome: string
          saldo_remanescente_anterior: number
          saldo_remanescente_novo: number
          valor_bruto: number
          valor_liquido: number
        }
        Insert: {
          ajuste_recorrentes?: Json
          ajuste_recorrentes_valor?: number
          ajuste_semestrais?: Json
          ajuste_semestrais_valor?: number
          calculado_em?: string
          calculado_por?: string | null
          competencia: string
          devolucao_valor?: number
          estado?: string
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          modo_teste?: boolean
          paciente_cpf?: string | null
          paciente_nome: string
          prestador_nome: string
          saldo_remanescente_anterior?: number
          saldo_remanescente_novo?: number
          valor_bruto: number
          valor_liquido?: number
        }
        Update: {
          ajuste_recorrentes?: Json
          ajuste_recorrentes_valor?: number
          ajuste_semestrais?: Json
          ajuste_semestrais_valor?: number
          calculado_em?: string
          calculado_por?: string | null
          competencia?: string
          devolucao_valor?: number
          estado?: string
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          modo_teste?: boolean
          paciente_cpf?: string | null
          paciente_nome?: string
          prestador_nome?: string
          saldo_remanescente_anterior?: number
          saldo_remanescente_novo?: number
          valor_bruto?: number
          valor_liquido?: number
        }
        Relationships: [
          {
            foreignKeyName: "pep_apuracao_mensal_calculado_por_fkey"
            columns: ["calculado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pep_apuracao_mensal_liberado_por_fkey"
            columns: ["liberado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pep_calendario_competencias: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          competencia: string
          observacao: string | null
          semanas_supervisao_estudo: number
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          competencia: string
          observacao?: string | null
          semanas_supervisao_estudo?: number
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          competencia?: string
          observacao?: string | null
          semanas_supervisao_estudo?: number
        }
        Relationships: [
          {
            foreignKeyName: "pep_calendario_competencias_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pep_catalogo_itens: {
        Row: {
          ativo: boolean
          classe: string
          codigo: string
          created_at: string
          id: string
          nome: string
          periodicidade: string
          peso_mensal: number
          qtd_referencia_mes: number | null
          sigla: string
          tipo_registro: string
        }
        Insert: {
          ativo?: boolean
          classe: string
          codigo: string
          created_at?: string
          id?: string
          nome: string
          periodicidade: string
          peso_mensal: number
          qtd_referencia_mes?: number | null
          sigla: string
          tipo_registro: string
        }
        Update: {
          ativo?: boolean
          classe?: string
          codigo?: string
          created_at?: string
          id?: string
          nome?: string
          periodicidade?: string
          peso_mensal?: number
          qtd_referencia_mes?: number | null
          sigla?: string
          tipo_registro?: string
        }
        Relationships: []
      }
      pep_planejamento_semestral: {
        Row: {
          ativo: boolean
          competencia_planejada: string
          criado_em: string
          criado_por: string | null
          evidencias: Json
          id: string
          item_id: string
          motivo: string | null
          origem: string
          paciente_cpf: string | null
          paciente_nome: string
          planejamento_anterior_id: string | null
          prestador_nome: string
        }
        Insert: {
          ativo?: boolean
          competencia_planejada: string
          criado_em?: string
          criado_por?: string | null
          evidencias?: Json
          id?: string
          item_id: string
          motivo?: string | null
          origem?: string
          paciente_cpf?: string | null
          paciente_nome: string
          planejamento_anterior_id?: string | null
          prestador_nome: string
        }
        Update: {
          ativo?: boolean
          competencia_planejada?: string
          criado_em?: string
          criado_por?: string | null
          evidencias?: Json
          id?: string
          item_id?: string
          motivo?: string | null
          origem?: string
          paciente_cpf?: string | null
          paciente_nome?: string
          planejamento_anterior_id?: string | null
          prestador_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "pep_planejamento_semestral_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pep_planejamento_semestral_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "pep_catalogo_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pep_planejamento_semestral_planejamento_anterior_id_fkey"
            columns: ["planejamento_anterior_id"]
            isOneToOne: false
            referencedRelation: "pep_planejamento_semestral"
            referencedColumns: ["id"]
          },
        ]
      }
      pep_registros_entrega: {
        Row: {
          chave_conflito: string | null
          competencia: string
          created_at: string
          entregue_em: string | null
          evidencias: Json
          id: string
          item_id: string
          observacao: string | null
          paciente_cpf: string | null
          paciente_nome: string | null
          prestador_nome: string
          quantidade_entregue: number | null
          registrado_por: string | null
          status: string
          updated_at: string
        }
        Insert: {
          chave_conflito?: string | null
          competencia: string
          created_at?: string
          entregue_em?: string | null
          evidencias?: Json
          id?: string
          item_id: string
          observacao?: string | null
          paciente_cpf?: string | null
          paciente_nome?: string | null
          prestador_nome: string
          quantidade_entregue?: number | null
          registrado_por?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          chave_conflito?: string | null
          competencia?: string
          created_at?: string
          entregue_em?: string | null
          evidencias?: Json
          id?: string
          item_id?: string
          observacao?: string | null
          paciente_cpf?: string | null
          paciente_nome?: string | null
          prestador_nome?: string
          quantidade_entregue?: number | null
          registrado_por?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pep_registros_entrega_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "pep_catalogo_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pep_registros_entrega_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pep_trilha_auditoria: {
        Row: {
          acao: string
          antes: Json | null
          competencia: string | null
          criado_em: string
          depois: Json | null
          id: string
          motivo: string | null
          paciente_nome: string | null
          prestador_nome: string
          registro_id: string
          tabela: string
          usuario_id: string | null
          usuario_nome: string | null
        }
        Insert: {
          acao: string
          antes?: Json | null
          competencia?: string | null
          criado_em?: string
          depois?: Json | null
          id?: string
          motivo?: string | null
          paciente_nome?: string | null
          prestador_nome: string
          registro_id: string
          tabela: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Update: {
          acao?: string
          antes?: Json | null
          competencia?: string | null
          criado_em?: string
          depois?: Json | null
          id?: string
          motivo?: string | null
          paciente_nome?: string | null
          prestador_nome?: string
          registro_id?: string
          tabela?: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pep_trilha_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis: {
        Row: {
          created_at: string | null
          id: string
          nome: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          nome?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string | null
          role?: string | null
        }
        Relationships: []
      }
      permissoes: {
        Row: {
          codigo: string
          created_at: string | null
          descricao: string | null
          grupo: string | null
          id: string
          nome: string
          rota: string | null
        }
        Insert: {
          codigo: string
          created_at?: string | null
          descricao?: string | null
          grupo?: string | null
          id?: string
          nome: string
          rota?: string | null
        }
        Update: {
          codigo?: string
          created_at?: string | null
          descricao?: string | null
          grupo?: string | null
          id?: string
          nome?: string
          rota?: string | null
        }
        Relationships: []
      }
      pre_auditoria_snapshot: {
        Row: {
          created_at: string | null
          data_ref: string | null
          erros: number | null
          faltas: number | null
          id: string
          liberados: number | null
          pendentes: number | null
          tokens: number | null
          total: number | null
        }
        Insert: {
          created_at?: string | null
          data_ref?: string | null
          erros?: number | null
          faltas?: number | null
          id?: string
          liberados?: number | null
          pendentes?: number | null
          tokens?: number | null
          total?: number | null
        }
        Update: {
          created_at?: string | null
          data_ref?: string | null
          erros?: number | null
          faltas?: number | null
          id?: string
          liberados?: number | null
          pendentes?: number | null
          tokens?: number | null
          total?: number | null
        }
        Relationships: []
      }
      previsao_receitas_historico: {
        Row: {
          competencia: string
          convenio_nome: string
          criado_em: string
          data_sessao: string
          em_falta: boolean
          hora_inicial: string | null
          id: number
          origem_valor: string
          paciente_id: number | null
          paciente_nome: string
          segmento: string
          snapshot_data: string
          terapia_id: number | null
          terapia_nome: string
          tita_agendamento_id: number | null
          valor: number | null
        }
        Insert: {
          competencia: string
          convenio_nome: string
          criado_em?: string
          data_sessao: string
          em_falta?: boolean
          hora_inicial?: string | null
          id?: number
          origem_valor: string
          paciente_id?: number | null
          paciente_nome: string
          segmento: string
          snapshot_data: string
          terapia_id?: number | null
          terapia_nome: string
          tita_agendamento_id?: number | null
          valor?: number | null
        }
        Update: {
          competencia?: string
          convenio_nome?: string
          criado_em?: string
          data_sessao?: string
          em_falta?: boolean
          hora_inicial?: string | null
          id?: number
          origem_valor?: string
          paciente_id?: number | null
          paciente_nome?: string
          segmento?: string
          snapshot_data?: string
          terapia_id?: number | null
          terapia_nome?: string
          tita_agendamento_id?: number | null
          valor?: number | null
        }
        Relationships: []
      }
      previsao_receitas_historico_resumo: {
        Row: {
          atualizado_em: string
          competencia: string
          deducao_falta: number
          faltas_mes: number
          pacientes_unicos: number
          receita_com_deducao: number
          receita_sem_deducao: number
          sessoes_mes: number
          snapshot_data: string
          status: string
        }
        Insert: {
          atualizado_em?: string
          competencia: string
          deducao_falta?: number
          faltas_mes?: number
          pacientes_unicos?: number
          receita_com_deducao?: number
          receita_sem_deducao?: number
          sessoes_mes?: number
          snapshot_data: string
          status: string
        }
        Update: {
          atualizado_em?: string
          competencia?: string
          deducao_falta?: number
          faltas_mes?: number
          pacientes_unicos?: number
          receita_com_deducao?: number
          receita_sem_deducao?: number
          sessoes_mes?: number
          snapshot_data?: string
          status?: string
        }
        Relationships: []
      }
      reboot_agendamentos: {
        Row: {
          atualizado_em: string
          criado_em: string
          data: string
          horario_fim: string
          horario_inicio: string
          id_agendamento: number
          id_paciente: number
          id_profissional: number
          id_serie: string | null
          id_usuario: string | null
          nome_usuario_responsavel: string | null
          status: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          data: string
          horario_fim: string
          horario_inicio: string
          id_agendamento?: never
          id_paciente: number
          id_profissional: number
          id_serie?: string | null
          id_usuario?: string | null
          nome_usuario_responsavel?: string | null
          status?: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          data?: string
          horario_fim?: string
          horario_inicio?: string
          id_agendamento?: never
          id_paciente?: number
          id_profissional?: number
          id_serie?: string | null
          id_usuario?: string | null
          nome_usuario_responsavel?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reboot_agendamentos_id_paciente_fkey"
            columns: ["id_paciente"]
            isOneToOne: false
            referencedRelation: "reboot_pacientes"
            referencedColumns: ["id_paciente"]
          },
          {
            foreignKeyName: "reboot_agendamentos_id_profissional_fkey"
            columns: ["id_profissional"]
            isOneToOne: false
            referencedRelation: "reboot_profissionais"
            referencedColumns: ["id_profissional"]
          },
          {
            foreignKeyName: "reboot_agendamentos_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      reboot_disponibilidade_profissional: {
        Row: {
          atualizado_em: string
          criado_em: string
          dia_semana: number
          duracao_sessao_minutos: number
          horario_fim: string
          horario_inicio: string
          id_disponibilidade: number
          id_profissional: number
          id_usuario: string | null
          intervalo_fim: string | null
          intervalo_inicio: string | null
          nome_usuario_responsavel: string | null
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          dia_semana: number
          duracao_sessao_minutos?: number
          horario_fim: string
          horario_inicio: string
          id_disponibilidade?: never
          id_profissional: number
          id_usuario?: string | null
          intervalo_fim?: string | null
          intervalo_inicio?: string | null
          nome_usuario_responsavel?: string | null
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          dia_semana?: number
          duracao_sessao_minutos?: number
          horario_fim?: string
          horario_inicio?: string
          id_disponibilidade?: never
          id_profissional?: number
          id_usuario?: string | null
          intervalo_fim?: string | null
          intervalo_inicio?: string | null
          nome_usuario_responsavel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reboot_disponibilidade_profissional_id_profissional_fkey"
            columns: ["id_profissional"]
            isOneToOne: false
            referencedRelation: "reboot_profissionais"
            referencedColumns: ["id_profissional"]
          },
          {
            foreignKeyName: "reboot_disponibilidade_profissional_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      reboot_pacientes: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          data_nascimento: string | null
          id_paciente: number
          id_usuario: string | null
          nome: string
          nome_usuario_responsavel: string | null
          telefone: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          data_nascimento?: string | null
          id_paciente?: never
          id_usuario?: string | null
          nome: string
          nome_usuario_responsavel?: string | null
          telefone?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          data_nascimento?: string | null
          id_paciente?: never
          id_usuario?: string | null
          nome?: string
          nome_usuario_responsavel?: string | null
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reboot_pacientes_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      reboot_profissionais: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          especialidade: string | null
          id_profissional: number
          id_usuario: string | null
          nome: string
          nome_usuario_responsavel: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          especialidade?: string | null
          id_profissional?: never
          id_usuario?: string | null
          nome: string
          nome_usuario_responsavel?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          especialidade?: string | null
          id_profissional?: never
          id_usuario?: string | null
          nome?: string
          nome_usuario_responsavel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reboot_profissionais_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      remuneracao_contratos: {
        Row: {
          cnpj: string | null
          contratos: Json
          cpf: string | null
          created_at: string
          documento_tipo: string | null
          id: string
          observacoes: string | null
          profissional_nome: string
          razao_social: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          contratos?: Json
          cpf?: string | null
          created_at?: string
          documento_tipo?: string | null
          id?: string
          observacoes?: string | null
          profissional_nome: string
          razao_social?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          contratos?: Json
          cpf?: string | null
          created_at?: string
          documento_tipo?: string | null
          id?: string
          observacoes?: string | null
          profissional_nome?: string
          razao_social?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      remuneracao_contratos_itens: {
        Row: {
          contrato_id: string
          created_at: string
          funcao: string | null
          id: string
          modelo_faturamento: string
          numero: string | null
          observacoes: string | null
          ordem: number
          updated_at: string
          valor_pa: number | null
          valor_pep_mensal: number | null
          valor_total: number | null
          vigente: boolean
        }
        Insert: {
          contrato_id: string
          created_at?: string
          funcao?: string | null
          id?: string
          modelo_faturamento?: string
          numero?: string | null
          observacoes?: string | null
          ordem?: number
          updated_at?: string
          valor_pa?: number | null
          valor_pep_mensal?: number | null
          valor_total?: number | null
          vigente?: boolean
        }
        Update: {
          contrato_id?: string
          created_at?: string
          funcao?: string | null
          id?: string
          modelo_faturamento?: string
          numero?: string | null
          observacoes?: string | null
          ordem?: number
          updated_at?: string
          valor_pa?: number | null
          valor_pep_mensal?: number | null
          valor_total?: number | null
          vigente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "remuneracao_contratos_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "remuneracao_contratos"
            referencedColumns: ["id"]
          },
        ]
      }
      remuneracao_historico: {
        Row: {
          created_at: string
          created_by: string | null
          dados: Json
          id: string
          mes_ano: string
          profissional_nome: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dados?: Json
          id?: string
          mes_ano: string
          profissional_nome?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dados?: Json
          id?: string
          mes_ano?: string
          profissional_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remuneracao_historico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      remuneracao_parametros_gerais: {
        Row: {
          cc_lim_default: number
          cc_pa_default: number
          cc_pe_default: number
          eta_bonus_default: number
          id: string
          presenca_padrao: number
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cc_lim_default?: number
          cc_pa_default?: number
          cc_pe_default?: number
          eta_bonus_default?: number
          id?: string
          presenca_padrao?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cc_lim_default?: number
          cc_pa_default?: number
          cc_pe_default?: number
          eta_bonus_default?: number
          id?: string
          presenca_padrao?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remuneracao_parametros_gerais_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      remuneracao_taxas_especialidade: {
        Row: {
          created_at: string
          diaria: number
          especialidade: string
          id: string
          taxa_pa: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          diaria?: number
          especialidade: string
          id?: string
          taxa_pa?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          diaria?: number
          especialidade?: string
          id?: string
          taxa_pa?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remuneracao_taxas_especialidade_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      saida_aceites: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          criado_em: string
          criado_por: string | null
          dados: Json
          dia: string
          hora: string
          id: number
          paciente: string
          status: string
          terapia: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          dia: string
          hora: string
          id?: number
          paciente: string
          status?: string
          terapia: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          criado_em?: string
          criado_por?: string | null
          dados?: Json
          dia?: string
          hora?: string
          id?: number
          paciente?: string
          status?: string
          terapia?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string | null
          id: string
          last_seen: string | null
          machine_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          last_seen?: string | null
          machine_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_seen?: string | null
          machine_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      substituicoes_historico: {
        Row: {
          cancelada: boolean
          cancelada_em: string | null
          cancelada_por: string | null
          competencia: string
          data_criacao: string
          data_sessao: string
          horario_fim: string | null
          horario_inicio: string | null
          id: number
          motivo: string | null
          motivo_cancelamento: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_original_id: number | null
          profissional_original_nome: string | null
          profissional_substituto_id: number
          profissional_substituto_nome: string
          sessao_id: number | null
          terapia_real: string
          unidade_nome: string | null
          usuario_responsavel: string | null
        }
        Insert: {
          cancelada?: boolean
          cancelada_em?: string | null
          cancelada_por?: string | null
          competencia: string
          data_criacao?: string
          data_sessao: string
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: number
          motivo?: string | null
          motivo_cancelamento?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_original_id?: number | null
          profissional_original_nome?: string | null
          profissional_substituto_id: number
          profissional_substituto_nome: string
          sessao_id?: number | null
          terapia_real: string
          unidade_nome?: string | null
          usuario_responsavel?: string | null
        }
        Update: {
          cancelada?: boolean
          cancelada_em?: string | null
          cancelada_por?: string | null
          competencia?: string
          data_criacao?: string
          data_sessao?: string
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: number
          motivo?: string | null
          motivo_cancelamento?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_original_id?: number | null
          profissional_original_nome?: string | null
          profissional_substituto_id?: number
          profissional_substituto_nome?: string
          sessao_id?: number | null
          terapia_real?: string
          unidade_nome?: string | null
          usuario_responsavel?: string | null
        }
        Relationships: []
      }
      sync_controle: {
        Row: {
          force: boolean | null
          id: number
          last_run: string | null
          machine_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          force?: boolean | null
          id?: number
          last_run?: string | null
          machine_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          force?: boolean | null
          id?: number
          last_run?: string | null
          machine_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_status: {
        Row: {
          id: number
          status: string | null
          updated_at: string | null
        }
        Insert: {
          id: number
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      terapeuta_eventos: {
        Row: {
          created_at: string | null
          data_evento: string
          evento: string
          horario_referencia: string | null
          id: number
          observacao: string | null
          sala: string | null
          substituto: string | null
          terapeuta: string
          terapia: string | null
          unidade: string | null
          usuario: string | null
        }
        Insert: {
          created_at?: string | null
          data_evento: string
          evento: string
          horario_referencia?: string | null
          id?: number
          observacao?: string | null
          sala?: string | null
          substituto?: string | null
          terapeuta: string
          terapia?: string | null
          unidade?: string | null
          usuario?: string | null
        }
        Update: {
          created_at?: string | null
          data_evento?: string
          evento?: string
          horario_referencia?: string | null
          id?: number
          observacao?: string | null
          sala?: string | null
          substituto?: string | null
          terapeuta?: string
          terapia?: string | null
          unidade?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
      terapeutas: {
        Row: {
          carimbo_digital: string | null
          created_at: string | null
          email: string | null
          id: string
          nome: string
        }
        Insert: {
          carimbo_digital?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nome: string
        }
        Update: {
          carimbo_digital?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      terapias_controle: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          terapia_id: number
          terapia_nome: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          terapia_id: number
          terapia_nome: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          terapia_id?: number
          terapia_nome?: string
        }
        Relationships: []
      }
      tita_grade_profissionais: {
        Row: {
          cpf_profissional: string | null
          created_at: string | null
          data_atendimento: string
          grade_clinica_id: number | null
          grade_terapeuta_id: number | null
          hora_final: string | null
          hora_inicial: string | null
          id: number
          raw_json: Json | null
          sala: string | null
          status_agendamento: string | null
          terapeuta_id: number | null
          terapeuta_nome: string
          terapia: string | null
          unidade: string | null
        }
        Insert: {
          cpf_profissional?: string | null
          created_at?: string | null
          data_atendimento: string
          grade_clinica_id?: number | null
          grade_terapeuta_id?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          raw_json?: Json | null
          sala?: string | null
          status_agendamento?: string | null
          terapeuta_id?: number | null
          terapeuta_nome: string
          terapia?: string | null
          unidade?: string | null
        }
        Update: {
          cpf_profissional?: string | null
          created_at?: string | null
          data_atendimento?: string
          grade_clinica_id?: number | null
          grade_terapeuta_id?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number
          raw_json?: Json | null
          sala?: string | null
          status_agendamento?: string | null
          terapeuta_id?: number | null
          terapeuta_nome?: string
          terapia?: string | null
          unidade?: string | null
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          ativo: boolean | null
          central_role: string | null
          created_at: string | null
          email: string
          id: string
          nome: string
          organization_id: string
          primeiro_acesso: boolean | null
          role: string
          ultimo_acesso: string | null
          unidade: string | null
          unidades: string[] | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          ativo?: boolean | null
          central_role?: string | null
          created_at?: string | null
          email: string
          id: string
          nome: string
          organization_id?: string
          primeiro_acesso?: boolean | null
          role?: string
          ultimo_acesso?: string | null
          unidade?: string | null
          unidades?: string[] | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          ativo?: boolean | null
          central_role?: string | null
          created_at?: string | null
          email?: string
          id?: string
          nome?: string
          organization_id?: string
          primeiro_acesso?: boolean | null
          role?: string
          ultimo_acesso?: string | null
          unidade?: string | null
          unidades?: string[] | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
      usuarios_permissoes: {
        Row: {
          created_at: string | null
          id: string
          permissao_codigo: string
          permitido: boolean
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permissao_codigo: string
          permitido?: boolean
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permissao_codigo?: string
          permitido?: boolean
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_permissoes_permissao_codigo_fkey"
            columns: ["permissao_codigo"]
            isOneToOne: false
            referencedRelation: "permissoes"
            referencedColumns: ["codigo"]
          },
        ]
      }
      vw_central_pacientes_backup_20260508: {
        Row: {
          agenda_id: string | null
          assim_updated_at: string | null
          classificacao_terapia: string | null
          clinica_nome: string | null
          completion_type: string | null
          convenio: string | null
          convenio_nome: string | null
          created_at: string | null
          data_atendimento: string | null
          data_horario: string | null
          error_message: string | null
          execution_time_ms: number | null
          hora_final: string | null
          hora_inicial: string | null
          horario: string | null
          horario_autorizacao: string | null
          id: string | null
          machine_id: string | null
          numero_autorizacao: string | null
          numero_carteirinha: string | null
          paciente_id: string | null
          paciente_nome: string | null
          profissional_id: number | null
          profissional_nome: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_nome: string | null
          status: string | null
          status_assim: string | null
          status_operacional: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          unidade: string | null
          updated_at: string | null
          usuario_nome: string | null
        }
        Insert: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          classificacao_terapia?: string | null
          clinica_nome?: string | null
          completion_type?: string | null
          convenio?: string | null
          convenio_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          horario?: string | null
          horario_autorizacao?: string | null
          id?: string | null
          machine_id?: string | null
          numero_autorizacao?: string | null
          numero_carteirinha?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_nome?: string | null
          status?: string | null
          status_assim?: string | null
          status_operacional?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          unidade?: string | null
          updated_at?: string | null
          usuario_nome?: string | null
        }
        Update: {
          agenda_id?: string | null
          assim_updated_at?: string | null
          classificacao_terapia?: string | null
          clinica_nome?: string | null
          completion_type?: string | null
          convenio?: string | null
          convenio_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          error_message?: string | null
          execution_time_ms?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          horario?: string | null
          horario_autorizacao?: string | null
          id?: string | null
          machine_id?: string | null
          numero_autorizacao?: string | null
          numero_carteirinha?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          sala_nome?: string | null
          status?: string | null
          status_assim?: string | null
          status_operacional?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          unidade?: string | null
          updated_at?: string | null
          usuario_nome?: string | null
        }
        Relationships: []
      }
      worker_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          token: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          token: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          token?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      agenda_classificada: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          crm: string | null
          data_atendimento: string | null
          dep: string | null
          empresa: string | null
          horario: string | null
          id: string | null
          matricula: string | null
          nome_medico: string | null
          paciente_id: string | null
          paciente_nome: string | null
          status: string | null
          terapia: string | null
          tuss: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          dep?: string | null
          empresa?: string | null
          horario?: string | null
          id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: never
          terapia?: string | null
          tuss?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          dep?: string | null
          empresa?: string | null
          horario?: string | null
          id?: string | null
          matricula?: string | null
          nome_medico?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: never
          terapia?: string | null
          tuss?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agenda_tita_autorizacao: {
        Row: {
          atividade: string | null
          ativo: boolean | null
          clinica_id: number | null
          clinica_nome: string | null
          codigo_tuss: string | null
          convenio_id: number | null
          convenio_nome: string | null
          cpf: string | null
          created_at: string | null
          crm: string | null
          data_atendimento: string | null
          data_nascimento: string | null
          dep: string | null
          empresa: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number | null
          matricula: string | null
          nome_medico: string | null
          numero_carteirinha: string | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          raw_json: Json | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      agenda_tita_autorizacao_v2: {
        Row: {
          atividade: string | null
          ativo: boolean | null
          clinica_id: number | null
          clinica_nome: string | null
          convenio_id: number | null
          convenio_nome: string | null
          cpf: string | null
          created_at: string | null
          crm: string | null
          crm_numero: string | null
          crm_uf: string | null
          data_atendimento: string | null
          data_nascimento: string | null
          dep: string | null
          empresa: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number | null
          matricula: string | null
          nome_medico: string | null
          numero_carteirinha: string | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          raw_json: Json | null
          responsavel_email: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      occurrences: {
        Row: {
          acao_recomendada: string | null
          created_at: string | null
          descricao: string | null
          fingerprint: string | null
          id: string | null
          impacto_financeiro: number | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          responsavel_acao: string | null
          session_key: string | null
          severity: "CRITICAL" | "WARNING" | "INFO" | null
          tipo:
            | "AUTORIZACAO_PENDENTE"
            | "SESSAO_SEM_AUTORIZACAO"
            | "EVOLUCAO_ATRASADA"
            | "FALTA_TERAPEUTA"
            | "SUBSTITUICAO"
            | "FALTA_PACIENTE"
            | "GLOSA"
            | null
          titulo: string | null
          updated_at: string | null
        }
        Insert: {
          acao_recomendada?: string | null
          created_at?: string | null
          descricao?: string | null
          fingerprint?: string | null
          id?: string | null
          impacto_financeiro?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsavel_acao?: string | null
          session_key?: string | null
          severity?: "CRITICAL" | "WARNING" | "INFO" | null
          tipo?:
            | "AUTORIZACAO_PENDENTE"
            | "SESSAO_SEM_AUTORIZACAO"
            | "EVOLUCAO_ATRASADA"
            | "FALTA_TERAPEUTA"
            | "SUBSTITUICAO"
            | "FALTA_PACIENTE"
            | "GLOSA"
            | null
          titulo?: string | null
          updated_at?: string | null
        }
        Update: {
          acao_recomendada?: string | null
          created_at?: string | null
          descricao?: string | null
          fingerprint?: string | null
          id?: string | null
          impacto_financeiro?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responsavel_acao?: string | null
          session_key?: string | null
          severity?: "CRITICAL" | "WARNING" | "INFO" | null
          tipo?:
            | "AUTORIZACAO_PENDENTE"
            | "SESSAO_SEM_AUTORIZACAO"
            | "EVOLUCAO_ATRASADA"
            | "FALTA_TERAPEUTA"
            | "SUBSTITUICAO"
            | "FALTA_PACIENTE"
            | "GLOSA"
            | null
          titulo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_acomp_auditoria: {
        Row: {
          bundle_id: string | null
          conflitos: number | null
          criadas: number | null
          criado_em: string | null
          data: string | null
          dia_sessao: string | null
          evento: string | null
          hora_registro: string | null
          hora_sessao: string | null
          id: number | null
          id_agenda_fav: number | null
          lote_id: string | null
          paciente: string | null
          profissional: string | null
          rejeitadas: number | null
          resultado: string | null
          status_bundle: string | null
          terapia: string | null
          unidade: string | null
          usuario: string | null
          usuario_id: string | null
        }
        Insert: {
          bundle_id?: string | null
          conflitos?: number | null
          criadas?: number | null
          criado_em?: string | null
          data?: never
          dia_sessao?: string | null
          evento?: string | null
          hora_registro?: never
          hora_sessao?: string | null
          id?: number | null
          id_agenda_fav?: number | null
          lote_id?: string | null
          paciente?: string | null
          profissional?: string | null
          rejeitadas?: number | null
          resultado?: string | null
          status_bundle?: string | null
          terapia?: string | null
          unidade?: string | null
          usuario?: string | null
          usuario_id?: string | null
        }
        Update: {
          bundle_id?: string | null
          conflitos?: number | null
          criadas?: number | null
          criado_em?: string | null
          data?: never
          dia_sessao?: string | null
          evento?: string | null
          hora_registro?: never
          hora_sessao?: string | null
          id?: number | null
          id_agenda_fav?: number | null
          lote_id?: string | null
          paciente?: string | null
          profissional?: string | null
          rejeitadas?: number | null
          resultado?: string | null
          status_bundle?: string | null
          terapia?: string | null
          unidade?: string | null
          usuario?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      vw_auditoria_autorizacoes_assim: {
        Row: {
          autorizacao_updated_at: string | null
          bloco_id: string | null
          carteirinha: string | null
          codigo_erro: string | null
          codigo_tuss: string | null
          convenio_nome: string | null
          data_atendimento: string | null
          data_execucao: string | null
          dep: string | null
          descricao_erro: string | null
          dias_atraso: number | null
          diferenca_minutos: number | null
          empresa: string | null
          guia: string | null
          hora_inicial: string | null
          matricula: string | null
          motivo_glosa: string | null
          observacao: string | null
          paciente_id: number | null
          paciente_nome: string | null
          possui_autorizacao: boolean | null
          possui_solicitacao: boolean | null
          prioridade: number | null
          profissionais: string | null
          quantidade_sessoes: number | null
          situacao: string | null
          status_assim: string | null
          terapias: string | null
        }
        Relationships: []
      }
      vw_blocos_autorizaveis_assim: {
        Row: {
          bloco_id: string | null
          carteirinha: string | null
          codigo_tuss: string | null
          convenio_nome: string | null
          data_atendimento: string | null
          dep: string | null
          empresa: string | null
          hora_inicial: string | null
          matricula: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissionais: string | null
          quantidade_sessoes: number | null
          terapias: string | null
        }
        Relationships: []
      }
      vw_central_autorizacoes: {
        Row: {
          agendamentos: string[] | null
          cancelado_por_nome: string | null
          codigos_tuss: string[] | null
          convenio_id: number | null
          convenio_nome: string | null
          cpf: string | null
          crm: string | null
          data_atendimento: string | null
          data_nascimento: string | null
          dep: string | null
          empresa: string | null
          horario: string | null
          horario_autorizacao: string | null
          matricula: string | null
          mostrar_na_tela: boolean | null
          nome_medico: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissionais: string[] | null
          sala_nome: string[] | null
          status_final: string | null
          terapias: string[] | null
          tipo_fluxo: string | null
          ultima_autorizacao_anterior: string | null
        }
        Relationships: []
      }
      vw_central_pacientes: {
        Row: {
          agenda_id: string | null
          assim_updated_at: string | null
          classificacao_terapia: string | null
          clinica_nome: string | null
          completion_type: string | null
          confirmado_em: string | null
          confirmado_por_nome: string | null
          controle_status: string | null
          convenio: string | null
          convenio_nome: string | null
          created_at: string | null
          criado_por: string | null
          data_atendimento: string | null
          data_horario: string | null
          error_message: string | null
          execution_time_ms: number | null
          forma_autorizacao: string | null
          hora_final: string | null
          hora_inicial: string | null
          horario: string | null
          horario_autorizacao: string | null
          id: string | null
          is_substituicao: boolean | null
          machine_id: string | null
          numero_autorizacao: string | null
          numero_carteirinha: string | null
          paciente_id: string | null
          paciente_nome: string | null
          profissional_id: number | null
          profissional_nome: string | null
          profissional_realizou_nome: string | null
          profissional_substituto_nome: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_nome: string | null
          status: string | null
          status_assim: string | null
          status_operacional: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          unidade: string | null
          updated_at: string | null
          usuario_nome: string | null
        }
        Relationships: []
      }
      vw_central_terapeutica: {
        Row: {
          clinica_id: number | null
          clinica_nome: string | null
          confirmado_em: string | null
          confirmado_por: string | null
          confirmado_por_nome: string | null
          controle_created_at: string | null
          controle_updated_at: string | null
          convenio_nome: string | null
          data_atendimento: string | null
          hora_final: string | null
          hora_inicial: string | null
          observacao: string | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_id: number | null
          profissional_nome: string | null
          profissional_substituto_id: number | null
          profissional_substituto_nome: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_operacional: string | null
          status: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          unidade: string | null
        }
        Relationships: []
      }
      vw_controle_terapeutico: {
        Row: {
          confirmado_em: string | null
          confirmado_por_nome: string | null
          created_at: string | null
          data_atendimento: string | null
          data_atualizacao: string | null
          falta_descoberta: boolean | null
          foi_substituido: boolean | null
          hora_final: string | null
          hora_inicial: string | null
          houve_falta: boolean | null
          id: string | null
          observacao: string | null
          profissional_id: number | null
          profissional_nome: string | null
          profissional_substituto_id: number | null
          profissional_substituto_nome: string | null
          situacao: string | null
          status: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          updated_at: string | null
        }
        Insert: {
          confirmado_em?: string | null
          confirmado_por_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_atualizacao?: string | null
          falta_descoberta?: never
          foi_substituido?: never
          hora_final?: string | null
          hora_inicial?: string | null
          houve_falta?: never
          id?: string | null
          observacao?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          profissional_substituto_id?: number | null
          profissional_substituto_nome?: string | null
          situacao?: never
          status?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Update: {
          confirmado_em?: string | null
          confirmado_por_nome?: string | null
          created_at?: string | null
          data_atendimento?: string | null
          data_atualizacao?: string | null
          falta_descoberta?: never
          foi_substituido?: never
          hora_final?: string | null
          hora_inicial?: string | null
          houve_falta?: never
          id?: string | null
          observacao?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          profissional_substituto_id?: number | null
          profissional_substituto_nome?: string | null
          situacao?: never
          status?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_cronograma_profissionais_salas: {
        Row: {
          profissional_id: number | null
          profissional_nome: string | null
        }
        Relationships: []
      }
      vw_faltas_pacientes: {
        Row: {
          assim_updated_at: string | null
          created_at: string | null
          crm: string | null
          data_atendimento: string | null
          data_horario: string | null
          horario: string | null
          id: string | null
          justificativa_falta: string | null
          machine_id: string | null
          nome_medico: string | null
          paciente_id: string | null
          paciente_nome: string | null
          status_assim: string | null
          terapia_falta: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          tita_agendamento_id: number | null
          updated_at: string | null
        }
        Insert: {
          assim_updated_at?: string | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          horario?: string | null
          id?: string | null
          justificativa_falta?: string | null
          machine_id?: string | null
          nome_medico?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status_assim?: string | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Update: {
          assim_updated_at?: string | null
          created_at?: string | null
          crm?: string | null
          data_atendimento?: string | null
          data_horario?: string | null
          horario?: string | null
          id?: string | null
          justificativa_falta?: string | null
          machine_id?: string | null
          nome_medico?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status_assim?: string | null
          terapia_falta?: string | null
          terapia_nome?: string | null
          tipo_falta?: string | null
          tita_agendamento_id?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_grade_atendimentos: {
        Row: {
          ano: number | null
          ano_mes: string | null
          convenio_nome: string | null
          criado_em_tita: string | null
          data: string | null
          dia_semana: string | null
          evolucao_vinculo: string | null
          excluido_em_tita: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: string | null
          is_congelado: boolean | null
          is_dia_util: boolean | null
          is_primeira_semana: boolean | null
          is_primeiro_dia_mes: boolean | null
          is_ultima_data_mes: boolean | null
          is_ultima_semana: boolean | null
          justificativa: string | null
          mes: number | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          possui_tratativa: boolean | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_nome: string | null
          semana_do_mes: number | null
          semana_iso: number | null
          status_agendamento: string | null
          status_execucao: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          tratativa_criada_em: string | null
          tratativa_origem: string | null
          tratativa_profissional_id: number | null
          tratativa_profissional_nome: string | null
          unidade_id: number | null
          unidade_nome: string | null
        }
        Insert: {
          ano?: never
          ano_mes?: never
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          is_congelado?: never
          is_dia_util?: never
          is_primeira_semana?: never
          is_primeiro_dia_mes?: never
          is_ultima_data_mes?: never
          is_ultima_semana?: never
          justificativa?: string | null
          mes?: never
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_nome?: string | null
          semana_do_mes?: never
          semana_iso?: never
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          unidade_id?: number | null
          unidade_nome?: string | null
        }
        Update: {
          ano?: never
          ano_mes?: never
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          is_congelado?: never
          is_dia_util?: never
          is_primeira_semana?: never
          is_primeiro_dia_mes?: never
          is_ultima_data_mes?: never
          is_ultima_semana?: never
          justificativa?: string | null
          mes?: never
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_nome?: string | null
          semana_do_mes?: never
          semana_iso?: never
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          unidade_id?: number | null
          unidade_nome?: string | null
        }
        Relationships: []
      }
      vw_grade_base: {
        Row: {
          ano: number | null
          ano_mes: string | null
          convenio_nome: string | null
          criado_em_tita: string | null
          data: string | null
          dia_semana: string | null
          evolucao_vinculo: string | null
          excluido_em_tita: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: string | null
          is_congelado: boolean | null
          is_dia_util: boolean | null
          is_primeira_semana: boolean | null
          is_primeiro_dia_mes: boolean | null
          is_ultima_data_mes: boolean | null
          is_ultima_semana: boolean | null
          justificativa: string | null
          mes: number | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          possui_tratativa: boolean | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_nome: string | null
          semana_do_mes: number | null
          semana_iso: number | null
          status_agendamento: string | null
          status_execucao: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          tratativa_criada_em: string | null
          tratativa_origem: string | null
          tratativa_profissional_id: number | null
          tratativa_profissional_nome: string | null
          tratativas: number | null
          tratativas_distintas: number | null
          unidade_id: number | null
          unidade_nome: string | null
        }
        Insert: {
          ano?: never
          ano_mes?: never
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          is_congelado?: never
          is_dia_util?: never
          is_primeira_semana?: never
          is_primeiro_dia_mes?: never
          is_ultima_data_mes?: never
          is_ultima_semana?: never
          justificativa?: string | null
          mes?: never
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_nome?: string | null
          semana_do_mes?: never
          semana_iso?: never
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          tratativas?: number | null
          tratativas_distintas?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
        }
        Update: {
          ano?: never
          ano_mes?: never
          convenio_nome?: string | null
          criado_em_tita?: string | null
          data?: string | null
          dia_semana?: string | null
          evolucao_vinculo?: string | null
          excluido_em_tita?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          is_congelado?: never
          is_dia_util?: never
          is_primeira_semana?: never
          is_primeiro_dia_mes?: never
          is_ultima_data_mes?: never
          is_ultima_semana?: never
          justificativa?: string | null
          mes?: never
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_nome?: string | null
          semana_do_mes?: never
          semana_iso?: never
          status_agendamento?: string | null
          status_execucao?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          tratativa_criada_em?: string | null
          tratativa_origem?: string | null
          tratativa_profissional_id?: number | null
          tratativa_profissional_nome?: string | null
          tratativas?: number | null
          tratativas_distintas?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
        }
        Relationships: []
      }
      vw_grade_inativas: {
        Row: {
          ano_mes: string | null
          ausencia_confirmada_em: string | null
          data: string | null
          hora_inicial: string | null
          id: string | null
          inativado_em: string | null
          motivo_inativacao: string | null
          origem: string | null
          paciente_id: number | null
          paciente_nome: string | null
          possui_tratativa: boolean | null
          profissional_id: number | null
          profissional_nome: string | null
          status_agendamento: string | null
          status_execucao: string | null
          tem_substituta_ativa: boolean | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          unidade_id: number | null
          visto_em: string | null
        }
        Insert: {
          ano_mes?: never
          ausencia_confirmada_em?: string | null
          data?: string | null
          hora_inicial?: string | null
          id?: string | null
          inativado_em?: string | null
          motivo_inativacao?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          status_agendamento?: string | null
          status_execucao?: string | null
          tem_substituta_ativa?: never
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          visto_em?: string | null
        }
        Update: {
          ano_mes?: never
          ausencia_confirmada_em?: string | null
          data?: string | null
          hora_inicial?: string | null
          id?: string | null
          inativado_em?: string | null
          motivo_inativacao?: string | null
          origem?: string | null
          paciente_id?: number | null
          paciente_nome?: string | null
          possui_tratativa?: boolean | null
          profissional_id?: number | null
          profissional_nome?: string | null
          status_agendamento?: string | null
          status_execucao?: string | null
          tem_substituta_ativa?: never
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          visto_em?: string | null
        }
        Relationships: []
      }
      vw_grade_opcoes: {
        Row: {
          id: number | null
          nome: string | null
          tipo: string | null
        }
        Relationships: []
      }
      vw_kpis_auditoria_assim: {
        Row: {
          aguardando_retorno: number | null
          canceladas: number | null
          faltas: number | null
          glosas: number | null
          liberadas: number | null
          nao_solicitadas: number | null
          total: number | null
        }
        Relationships: []
      }
      vw_match_autorizacoes_assim: {
        Row: {
          codigo_tuss: string | null
          consome_autorizacao: boolean | null
          cpf: string | null
          data_atendimento: string | null
          data_execucao: string | null
          data_nascimento: string | null
          guia: string | null
          hora_inicial: string | null
          ordem_autorizacao: number | null
          ordem_consumo: number | null
          paciente_id: number | null
          paciente_nome: string | null
          status_assim: string | null
          tita_agendamento_id: number | null
        }
        Relationships: []
      }
      vw_modal_substituicao_terapeutas: {
        Row: {
          data_grade: string | null
          hora: string | null
          paciente_nome: string | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_nome: string | null
          status_slot: string | null
          terapia_exibicao_nome: string | null
          terapia_nome: string | null
          unidade: string | null
        }
        Relationships: []
      }
      vw_profissionais_disponiveis: {
        Row: {
          cbo_profissional: string | null
          cpf_profissional: string | null
          created_at: string | null
          data: string | null
          dia_semana: string | null
          grade_clinica_id: number | null
          grade_terapeuta_id: number | null
          hora_final: string | null
          hora_inicial: string | null
          id: string | null
          id_sala: number | null
          id_unidade: number | null
          nome_profissional: string | null
          nome_terapia: string | null
          nome_unidade: string | null
          numero_telefone: string | null
          observacoes_sala: string | null
          profissional_id: number | null
          raw_json: Json | null
          registro_profissional: string | null
          sala: string | null
          status_agendamento: string | null
          terapia_exibicao: string | null
          terapia_exibicao_id: number | null
          terapia_id: number | null
          tipo_registro_profissional: string | null
          uf_registro_profissional: string | null
          updated_at: string | null
        }
        Insert: {
          cbo_profissional?: string | null
          cpf_profissional?: string | null
          created_at?: string | null
          data?: string | null
          dia_semana?: string | null
          grade_clinica_id?: number | null
          grade_terapeuta_id?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          id_sala?: number | null
          id_unidade?: number | null
          nome_profissional?: string | null
          nome_terapia?: string | null
          nome_unidade?: string | null
          numero_telefone?: string | null
          observacoes_sala?: string | null
          profissional_id?: number | null
          raw_json?: Json | null
          registro_profissional?: string | null
          sala?: string | null
          status_agendamento?: string | null
          terapia_exibicao?: string | null
          terapia_exibicao_id?: number | null
          terapia_id?: number | null
          tipo_registro_profissional?: string | null
          uf_registro_profissional?: string | null
          updated_at?: string | null
        }
        Update: {
          cbo_profissional?: string | null
          cpf_profissional?: string | null
          created_at?: string | null
          data?: string | null
          dia_semana?: string | null
          grade_clinica_id?: number | null
          grade_terapeuta_id?: number | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: string | null
          id_sala?: number | null
          id_unidade?: number | null
          nome_profissional?: string | null
          nome_terapia?: string | null
          nome_unidade?: string | null
          numero_telefone?: string | null
          observacoes_sala?: string | null
          profissional_id?: number | null
          raw_json?: Json | null
          registro_profissional?: string | null
          sala?: string | null
          status_agendamento?: string | null
          terapia_exibicao?: string | null
          terapia_exibicao_id?: number | null
          terapia_id?: number | null
          tipo_registro_profissional?: string | null
          uf_registro_profissional?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_remuneracao_profissionais_roster: {
        Row: {
          profissional_nome: string | null
          terapia_principal: string | null
        }
        Relationships: []
      }
      vw_reposicao_faltas: {
        Row: {
          convenio_nome: string | null
          data: string | null
          dia_semana: string | null
          hora_final: string | null
          hora_inicial: string | null
          id: number | null
          paciente_id: number | null
          paciente_nome: string | null
          profissional_cpf: string | null
          profissional_id: number | null
          profissional_nome: string | null
          sala_id: number | null
          sala_nome: string | null
          sala_observacoes: string | null
          status_agendamento: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_id: number | null
          terapia_nome: string | null
          tita_agendamento_id: number | null
          unidade_id: number | null
          unidade_nome: string | null
          updated_at: string | null
        }
        Insert: {
          convenio_nome?: string | null
          data?: string | null
          dia_semana?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
        }
        Update: {
          convenio_nome?: string | null
          data?: string | null
          dia_semana?: string | null
          hora_final?: string | null
          hora_inicial?: string | null
          id?: number | null
          paciente_id?: number | null
          paciente_nome?: string | null
          profissional_cpf?: string | null
          profissional_id?: number | null
          profissional_nome?: string | null
          sala_id?: number | null
          sala_nome?: string | null
          sala_observacoes?: string | null
          status_agendamento?: string | null
          terapia_exibicao_id?: number | null
          terapia_exibicao_nome?: string | null
          terapia_id?: number | null
          terapia_nome?: string | null
          tita_agendamento_id?: number | null
          unidade_id?: number | null
          unidade_nome?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_terapeutas_semana: {
        Row: {
          profissional_id: number | null
          profissional_nome: string | null
          terapia_exibicao_nome: string | null
          terapia_nome: string | null
          turno_semana: string | null
          unidade: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      batch_auto_resolve_occurrences: {
        Args: { p_active_session_keys: string[]; p_tipo: string }
        Returns: number
      }
      bytea_to_text: { Args: { data: string }; Returns: string }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      count_cco_records: {
        Args: never
        Returns: {
          record_count: number
          table_name: string
        }[]
      }
      count_test_data: {
        Args: never
        Returns: {
          table_name: string
          test_row_count: number
        }[]
      }
      create_worker_token: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      detect_r1_autorizacao_pendente: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_r2_sessao_sem_autorizacao: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_r3_evolucao_atrasada: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_r4_falta_terapeuta: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_r5_substituicao: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_r6_falta_paciente: {
        Args: never
        Returns: {
          justificativa: string
          session_key: string
        }[]
      }
      detect_r7_glosa: {
        Args: never
        Returns: {
          session_key: string
        }[]
      }
      detect_sessions_without_authorization: {
        Args: never
        Returns: {
          data_sessao: string
          session_key: string
          status_agendamento: string
        }[]
      }
      executar_relatorio_crm_inconsistente: {
        Args: never
        Returns: {
          nome_medico_normalizado: string
          qtd_crms: number
        }[]
      }
      fn_alerta_comentar: {
        Args: { p_alerta_id: string; p_texto: string }
        Returns: number
      }
      fn_alerta_criar: {
        Args: {
          p_descricao: string
          p_entidade_id: string
          p_entidade_ref: Json
          p_entidade_tipo: string
          p_modulo: string
          p_prioridade?: string
          p_setor_destino: string
          p_titulo: string
        }
        Returns: string
      }
      fn_alerta_pode_ver: { Args: { p_alerta_id: string }; Returns: boolean }
      fn_alerta_status: {
        Args: { p_alerta_id: string; p_status: string; p_texto?: string }
        Returns: undefined
      }
      fn_alertas_avaliar_assim: { Args: { p_data: string }; Returns: Json }
      fn_aplicar_execucao_grade: { Args: { p_linhas: Json }; Returns: number }
      fn_carga_dia: {
        Args: { p_data: string; profissional_ids: number[] }
        Returns: {
          profissional_id: number
          total: number
        }[]
      }
      fn_continuidade_semana: {
        Args: {
          p_data: string
          p_paciente_ids: number[]
          profissional_ids: number[]
        }
        Returns: {
          paciente_id: number
          profissional_id: number
        }[]
      }
      fn_match_tita_agendamento_id: {
        Args: {
          p_data: string
          p_horario: string
          p_paciente_id: string
          p_terapia_nome: string
        }
        Returns: number
      }
      fn_orbita_sync_targets: { Args: never; Returns: Json }
      fn_substituicoes_competencia: {
        Args: { p_competencia: string; profissional_ids: number[] }
        Returns: {
          profissional_id: number
          total: number
        }[]
      }
      fn_sync_grade_csv_em_lotes: { Args: never; Returns: undefined }
      fn_sync_grade_execucao_em_lotes: {
        Args: { p_dias_atras?: number }
        Returns: undefined
      }
      fn_sync_tita_grade: { Args: never; Returns: undefined }
      fn_sync_tita_grade_hoje: { Args: never; Returns: undefined }
      fn_sync_tita_hoje: { Args: never; Returns: undefined }
      fn_sync_tita_operacional: { Args: never; Returns: undefined }
      fn_sync_tita_planejamento: { Args: never; Returns: undefined }
      fn_sync_tita_reconciliacao: { Args: never; Returns: undefined }
      fn_sync_tita_semana: { Args: never; Returns: undefined }
      fn_usuario_role: { Args: never; Returns: string }
      get_alerta_historico: {
        Args: { p_entidade_id: string; p_entidade_tipo: string }
        Returns: {
          alerta_id: string
          autor_nome: string
          autor_tipo: string
          created_at: string
          descricao: string
          erro: string
          id: number
          metadata: Json
          status: string
          tipo: string
        }[]
      }
      get_alertas: {
        Args: { p_limit?: number; p_modulo?: string; p_status?: string }
        Returns: {
          criado_em: string
          criado_por: string
          criado_por_nome: string
          descricao: string
          entidade_id: string
          entidade_ref: Json
          entidade_tipo: string
          id: string
          modulo: string
          origem: string
          prioridade: string
          regra_codigo: string
          regra_nome: string
          resolucao: string
          resolvido_em: string
          setor_destino: string
          status: string
          titulo: string
          total_eventos: number
        }[]
      }
      get_alertas_contadores: {
        Args: { p_modulo?: string }
        Returns: {
          abertos: number
          conferidas_hoje: number
          criticos: number
          em_andamento: number
          total_pendente: number
        }[]
      }
      get_auditoria_assim: {
        Args: { p_data: string }
        Returns: {
          autorizacao_updated_at: string
          bloco_id: string
          carteirinha: string
          codigo_erro: string
          codigo_tuss: string
          convenio_nome: string
          data_atendimento: string
          data_execucao: string
          dep: string
          descricao_erro: string
          dias_atraso: number
          diferenca_minutos: number
          empresa: string
          guia: string
          hora_inicial: string
          matricula: string
          motivo_glosa: string
          observacao: string
          paciente_id: string
          paciente_nome: string
          possui_autorizacao: boolean
          possui_solicitacao: boolean
          prioridade: number
          profissionais: string
          quantidade_sessoes: number
          situacao: string
          status_assim: string
          terapias: string
          teve_token: boolean
          token: string
        }[]
      }
      get_cco_atendimentos: {
        Args: { p_data_fim: string; p_data_inicio: string }
        Returns: {
          authorization_status: string
          data_sessao: string
          data_tratativa: string
          hora_fim: string
          hora_inicio: string
          paciente_nome: string
          possui_tratativa: boolean
          profissional: string
          profissional_substituto: string
          profissional_tratativa: string
          session_key: string
          terapia: string
          tipos_ocorrencia: string[]
        }[]
      }
      get_cco_stats: {
        Args: never
        Returns: {
          atendimentos_ativos: number
          atendimentos_total: number
          dashboard_snapshots: number
          occurrences_ativas: number
          occurrences_total: number
          session_authorizations: number
          session_mutations: number
          session_substitutions: number
        }[]
      }
      get_dashboard_kpis: {
        Args: never
        Returns: {
          fazendinha: number
          metric_type: string
          padreMiguel: number
          realengo: number
          total: number
        }[]
      }
      get_faltas_auditoria_assim: {
        Args: { p_data: string }
        Returns: {
          data_atendimento: string
          hora_inicial: string
          paciente_id: string
          paciente_nome: string
          profissional_nome: string
          terapia_nome: string
          tipo_falta: string
          tuss: string
        }[]
      }
      get_kpis_auditoria_assim: {
        Args: { p_data: string }
        Returns: {
          canceladas: number
          faltas: number
          glosas: number
          liberadas: number
          nao_solicitadas: number
          retorno_nao_confirmado: number
          sincronizando: number
          total: number
        }[]
      }
      get_user_unit: { Args: never; Returns: string }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_diretoria: { Args: never; Returns: boolean }
      listar_central_autorizacoes: {
        Args: { p_data: string }
        Returns: {
          agendamentos: string[]
          cancelado_por_nome: string
          codigos_tuss: string[]
          convenio_id: number
          convenio_nome: string
          cpf: string
          crm: string
          data_atendimento: string
          data_nascimento: string
          dep: string
          empresa: string
          horario: string
          horario_autorizacao: string
          matricula: string
          mostrar_na_tela: boolean
          nome_medico: string
          paciente_id: number
          paciente_nome: string
          profissionais: string[]
          sala_nome: string[]
          status_final: string
          terapias: string[]
          tipo_fluxo: string
          ultima_autorizacao_anterior: string
        }[]
      }
      listar_central_pacientes: {
        Args: { p_data: string }
        Returns: {
          agenda_id: string | null
          assim_updated_at: string | null
          classificacao_terapia: string | null
          clinica_nome: string | null
          completion_type: string | null
          confirmado_em: string | null
          confirmado_por_nome: string | null
          controle_status: string | null
          convenio: string | null
          convenio_nome: string | null
          created_at: string | null
          criado_por: string | null
          data_atendimento: string | null
          data_horario: string | null
          error_message: string | null
          execution_time_ms: number | null
          forma_autorizacao: string | null
          hora_final: string | null
          hora_inicial: string | null
          horario: string | null
          horario_autorizacao: string | null
          id: string | null
          is_substituicao: boolean | null
          machine_id: string | null
          numero_autorizacao: string | null
          numero_carteirinha: string | null
          paciente_id: string | null
          paciente_nome: string | null
          profissional_id: number | null
          profissional_nome: string | null
          profissional_realizou_nome: string | null
          profissional_substituto_nome: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          sala_nome: string | null
          status: string | null
          status_assim: string | null
          status_operacional: string | null
          terapia_exibicao_id: number | null
          terapia_exibicao_nome: string | null
          terapia_nome: string | null
          tipo_falta: string | null
          unidade: string | null
          updated_at: string | null
          usuario_nome: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "vw_central_pacientes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reconciliar_guias_por_janela: {
        Args: {
          p_aplicar?: boolean
          p_ate: string
          p_de: string
          p_janela_max_seg?: number
        }
        Returns: {
          aplicado: boolean
          data_atendimento: string
          data_execucao: string
          fila_id: string
          guia: string
          horario: string
          janela_fim: string
          janela_inicio: string
          janela_seg: number
          paciente_nome: string
          terapia_nome: string
          tuss: string
        }[]
      }
      refresh_dashboard_kpis: { Args: never; Returns: undefined }
      remuneracao_has_role: { Args: { roles: string[] }; Returns: boolean }
      rpc_horarios_disponiveis: {
        Args: { p_data: string; p_unidade: string }
        Returns: {
          hora: string
        }[]
      }
      sample_cco_data: {
        Args: never
        Returns: {
          data_type: string
          sample: Json
        }[]
      }
      sync_assim_results: { Args: never; Returns: undefined }
      test_occurrences_view: {
        Args: never
        Returns: {
          columns: string
          record_count: number
          view_exists: boolean
        }[]
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      update_dashboard_snapshot: { Args: never; Returns: undefined }
      upsert_atendimentos: {
        Args: { p_rows: Json }
        Returns: {
          upserted_count: number
        }[]
      }
      upsert_occurrences: { Args: { p_rows: Json }; Returns: number }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
    }
    Enums: {
      status_terapeutico:
        | "pendente"
        | "presente"
        | "falta"
        | "atraso"
        | "cobertura_planejada"
        | "cobertura_confirmada"
        | "cancelado"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      status_terapeutico: [
        "pendente",
        "presente",
        "falta",
        "atraso",
        "cobertura_planejada",
        "cobertura_confirmada",
        "cancelado",
      ],
    },
  },
} as const

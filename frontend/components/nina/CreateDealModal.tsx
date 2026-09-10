import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { CalendarIcon, User, UserPlus, Phone, Mail, Building } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from './Button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { crmApi } from '@/services/crm/client';
import { Contact, TeamMember } from '@/types';
import { toast } from 'sonner';

// Schema para contato existente
const existingContactSchema = z.object({
  contact_mode: z.literal('existing'),
  contact_id: z.string().min(1, { message: 'Selecione um contato' }),
  new_contact_name: z.string().optional(),
  new_contact_phone: z.string().optional(),
  new_contact_email: z.string().optional(),
  title: z.string()
    .trim()
    .min(3, { message: 'Título deve ter no mínimo 3 caracteres' })
    .max(100, { message: 'Título deve ter no máximo 100 caracteres' }),
  company: z.string()
    .trim()
    .max(100, { message: 'Empresa deve ter no máximo 100 caracteres' })
    .optional(),
  value: z.coerce.number()
    .min(0, { message: 'Valor deve ser positivo' })
    .max(999999999, { message: 'Valor muito alto' })
    .default(0),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.string()
    .max(500, { message: 'Tags muito longas' })
    .optional(),
  due_date: z.date().optional(),
  owner_id: z.string().optional(),
});

// Schema para novo contato
const newContactSchema = z.object({
  contact_mode: z.literal('new'),
  contact_id: z.string().optional(),
  new_contact_name: z.string()
    .trim()
    .min(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
    .max(100, { message: 'Nome deve ter no máximo 100 caracteres' }),
  new_contact_phone: z.string()
    .trim()
    .min(10, { message: 'Telefone inválido' })
    .max(20, { message: 'Telefone muito longo' })
    .regex(/^[\d\s\+\-\(\)]+$/, { message: 'Telefone deve conter apenas números' }),
  new_contact_email: z.string()
    .trim()
    .email({ message: 'Email inválido' })
    .optional()
    .or(z.literal('')),
  title: z.string()
    .trim()
    .min(3, { message: 'Título deve ter no mínimo 3 caracteres' })
    .max(100, { message: 'Título deve ter no máximo 100 caracteres' }),
  company: z.string()
    .trim()
    .max(100, { message: 'Empresa deve ter no máximo 100 caracteres' })
    .optional(),
  value: z.coerce.number()
    .min(0, { message: 'Valor deve ser positivo' })
    .max(999999999, { message: 'Valor muito alto' })
    .default(0),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.string()
    .max(500, { message: 'Tags muito longas' })
    .optional(),
  due_date: z.date().optional(),
  owner_id: z.string().optional(),
});

const dealFormSchema = z.discriminatedUnion('contact_mode', [
  existingContactSchema,
  newContactSchema,
]);

type DealFormValues = z.infer<typeof dealFormSchema>;

interface CreateDealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDealCreated: () => void;
}

export const CreateDealModal: React.FC<CreateDealModalProps> = ({
  open,
  onOpenChange,
  onDealCreated,
}) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contactMode, setContactMode] = useState<'existing' | 'new'>('existing');

  const form = useForm<DealFormValues>({
    // @ts-ignore - Schema type mismatch (non-critical, form validation works at runtime)
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      contact_mode: 'existing',
      title: '',
      company: '',
      value: 0,
      priority: 'medium',
      tags: '',
      new_contact_name: '',
      new_contact_phone: '',
      new_contact_email: '',
    },
  });

  useEffect(() => {
    if (open) {
      const loadData = async () => {
        try {
          // Contatos vêm da Central (central.contacts) — é lá que eles vivem.
          // api.fetchContacts() devolvia [] fixo, então o seletor "contato
          // existente" nunca listava ninguém.
          const [respostaContatos, teamData] = await Promise.all([
            fetch('/api/central/contacts/?limit=200').then(r => r.json()),
            api.fetchTeam(),
          ]);
          setContacts(respostaContatos?.data ?? []);
          setTeamMembers(teamData);
        } catch (error) {
          console.error('Error loading data:', error);
        }
      };
      loadData();
    }
  }, [open]);

  const handleTabChange = (value: string) => {
    const mode = value as 'existing' | 'new';
    setContactMode(mode);
    form.setValue('contact_mode', mode);
  };

  const onSubmit = async (data: DealFormValues) => {
    setIsSubmitting(true);
    try {
      let contactId = data.contact_mode === 'existing' ? data.contact_id : '';

      // ------------------------------------------------------------------
      // Novo contato: vai por /api/central/contacts.
      //
      // O código anterior falava com `public.contacts` e `public.deals` pelo
      // client do browser — schemas que não existem (contatos ficam em
      // `central`, deals em `crm`), então nunca criou contato algum.
      //
      // Ele também apagava o deal recém-criado pelo trigger
      // crm.auto_create_deal_on_lead(). Isso não é mais necessário nem
      // desejável: o trigger só dispara para contact_type = 'lead', e um
      // contato criado aqui nasce como 'lead' de propósito — o deal que o
      // trigger cria É o deal que este formulário quer. Apagar e recriar
      // perderia o vínculo com a conversa de origem.
      // ------------------------------------------------------------------
      if (data.contact_mode === 'new') {
        // A API exige E.164 (+5521999999999). O formulário aceita o telefone
        // como a pessoa digita — "(21) 99999-9999" —, então normalizamos aqui.
        // Sem DDI assume-se Brasil, que é o caso de 100% dos contatos hoje.
        const somenteDigitos = data.new_contact_phone.replace(/\D/g, '');
        const telefoneE164 = somenteDigitos.startsWith('55')
          ? `+${somenteDigitos}`
          : `+55${somenteDigitos}`;

        // Barra final obrigatoria: trailingSlash:true faz POST sem barra virar
        // 308 que NAO chega ao handler.
        const resposta = await fetch('/api/central/contacts/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:         data.new_contact_name,
            displayPhone: telefoneE164,
            // contact_type 'lead' é o que faz o trigger
            // crm.auto_create_deal_on_lead() criar o deal automaticamente.
            contactType:  'lead',
            ...(data.new_contact_email
              ? { displayEmail: data.new_contact_email }
              : {}),
          }),
        });

        const corpo = await resposta.json().catch(() => null);

        if (!resposta.ok) {
          // 409 = telefone já cadastrado. É o caso comum, merece mensagem própria.
          toast.error(
            resposta.status === 409
              ? 'Já existe um contato com este telefone'
              : corpo?.error?.message ?? 'Erro ao criar contato'
          );
          setIsSubmitting(false);
          return;
        }

        contactId = corpo?.data?.id;
        toast.success('Contato criado com sucesso!');
      }

      const tagsArray = data.tags
        ? data.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

      // `company` do formulário não tem coluna correspondente em crm.deals
      // (é clínica, não B2B). Vai para a descrição para não se perder.
      const camposDoNegocio = {
        title:             data.title,
        description:       data.company || null,
        value:             data.value,
        priority:          data.priority,
        tags:              tagsArray,
        expectedCloseDate: data.due_date ? format(data.due_date, 'yyyy-MM-dd') : null,
      };

      // ------------------------------------------------------------------
      // Contato novo entrou como 'lead', então o trigger
      // crm.auto_create_deal_on_lead() JÁ criou um negócio para ele — e
      // uq_open_deal_per_contact permite só um aberto por contato.
      //
      // Criar outro aqui bateria em 409 sempre. O certo é preencher o que o
      // trigger criou (ele nasce com título genérico e sem valor) com o que
      // o formulário informou.
      //
      // A busca é por contactId + status aberto: é exatamente a chave do
      // índice único, então devolve no máximo um.
      // ------------------------------------------------------------------
      let dealDoTrigger: { id: string } | null = null;
      if (data.contact_mode === 'new' && contactId) {
        const busca = await fetch(
          `/api/crm/deals?status=open&limit=1000`
        ).then(r => r.json()).catch(() => null);

        dealDoTrigger =
          (busca?.data ?? []).find((d: any) => d.contact_id === contactId) ?? null;
      }

      if (dealDoTrigger) {
        await crmApi.updateDeal(dealDoTrigger.id, camposDoNegocio);
      } else {
        await crmApi.createDeal({
          ...camposDoNegocio,
          contactId: contactId || null,
          source:    'manual',
        });
      }

      toast.success('Deal criado com sucesso!');
      form.reset();
      setContactMode('existing');
      onOpenChange(false);
      onDealCreated();
    } catch (error) {
      console.error('Error creating deal:', error);
      // A mensagem do backend é a útil: diz se foi permissão, contato com deal
      // aberto (409) ou funil sem estágios.
      toast.error(error instanceof Error ? error.message : 'Erro ao criar deal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-slate-50">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">
            Criar Novo Deal
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Preencha as informações para criar uma nova oportunidade no pipeline.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          {/* @ts-ignore - Form handler type mismatch (non-critical) */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Tabs para escolher entre contato existente ou novo */}
            <Tabs value={contactMode} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-slate-800 p-1">
                <TabsTrigger
                  value="existing"
                  className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white text-slate-300 flex items-center gap-2"
                >
                  <User className="w-4 h-4" />
                  Contato Existente
                </TabsTrigger>
                <TabsTrigger
                  value="new"
                  className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white text-slate-300 flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Novo Contato
                </TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="mt-4 space-y-4">
                <FormField
                  control={form.control}
                  name="contact_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Contato *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 focus:ring-cyan-500 focus:border-cyan-500">
                            <SelectValue placeholder="Selecione um contato" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          {contacts.map((contact) => (
                            <SelectItem
                              key={contact.id}
                              value={contact.id}
                              className="text-slate-200 focus:bg-cyan-600 focus:text-white"
                            >
                              <div className="flex items-center gap-2">
                                <span>{contact.name || contact.phone || 'Sem nome'}</span>
                                {contact.phone && contact.name && (
                                  <span className="text-slate-400 text-xs">({contact.phone})</span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-slate-500">
                        Cliente ou lead associado a esta oportunidade
                      </FormDescription>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="new" className="mt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="new_contact_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200 flex items-center gap-2">
                          <User className="w-4 h-4 text-cyan-400" />
                          Nome *
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Nome do contato"
                            className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="new_contact_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-200 flex items-center gap-2">
                          <Phone className="w-4 h-4 text-cyan-400" />
                          Telefone *
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="+55 11 99999-9999"
                            className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className="text-slate-500">
                          Formato WhatsApp com código do país
                        </FormDescription>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="new_contact_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-cyan-400" />
                        Email (opcional)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="email@exemplo.com"
                          className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            {/* Campos do Deal */}
            <div className="border-t border-slate-700 pt-6 space-y-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Building className="w-5 h-5 text-cyan-400" />
                Informações do Deal
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Título *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex: Venda Premium..."
                          className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Empresa</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Nome da empresa"
                          className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Valor (R$)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Prioridade</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 focus:ring-cyan-500 focus:border-cyan-500">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          <SelectItem value="low" className="text-slate-200 focus:bg-cyan-600 focus:text-white">Baixa</SelectItem>
                          <SelectItem value="medium" className="text-slate-200 focus:bg-cyan-600 focus:text-white">Média</SelectItem>
                          <SelectItem value="high" className="text-slate-200 focus:bg-cyan-600 focus:text-white">Alta</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="due_date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className="text-slate-200">Data Prevista</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-full pl-3 text-left font-normal bg-slate-800 border-slate-600 hover:bg-slate-700 focus:ring-cyan-500',
                                !field.value && 'text-slate-500'
                              )}
                            >
                              {field.value ? (
                                format(field.value, 'dd/MM/yyyy')
                              ) : (
                                <span>Selecione uma data</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-slate-800 border-slate-600" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date()}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                      <FormDescription className="text-slate-500">
                        Previsão de fechamento
                      </FormDescription>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="owner_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-200">Responsável</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 focus:ring-cyan-500 focus:border-cyan-500">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          {teamMembers.map((member) => (
                            <SelectItem
                              key={member.id}
                              value={member.id}
                              className="text-slate-200 focus:bg-cyan-600 focus:text-white"
                            >
                              {member.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-200">Tags</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ex: premium, urgente (separadas por vírgula)"
                        className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-cyan-500 focus:border-cyan-500"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-slate-500">
                      Separe múltiplas tags com vírgula
                    </FormDescription>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-lg shadow-cyan-500/20"
              >
                {isSubmitting ? 'Criando...' : contactMode === 'new' ? 'Criar Contato e Deal' : 'Criar Deal'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

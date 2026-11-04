-- KI-Umbau der Warengruppen (Opus) ebenfalls in der Kostenstatistik erfassen
alter table ki_aufrufe drop constraint if exists ki_aufrufe_anlass_check;
alter table ki_aufrufe add constraint ki_aufrufe_anlass_check check (anlass in ('erkennung', 'nachlesen', 'manuell', 'gruppen'));

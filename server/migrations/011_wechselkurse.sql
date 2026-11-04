-- Tageskurse der EZB (je 1 Euro), damit vergangene KI-Kosten mit dem Kurs ihres Tages umgerechnet werden
create table wechselkurse (
  stand    date not null,
  waehrung text not null,
  je_euro  numeric(14, 6) not null,
  primary key (stand, waehrung)
);

-- US-Dollar-Betrag zum Zeitpunkt `zeit` in die Währung `ziel` umrechnen.
-- Maßgeblich ist der letzte Kurs am oder vor dem Tag; liegt keiner vor, der früheste bekannte. Ohne Kurse: null.
create function usd_in(betrag numeric, zeit timestamptz, ziel text) returns numeric
language sql stable as $$
  select case
    when betrag is null then null
    when ziel = 'USD' then betrag
    else betrag * coalesce(
      (select z.je_euro / u.je_euro from wechselkurse z join wechselkurse u on u.stand = z.stand and u.waehrung = 'USD'
        where z.waehrung = ziel and z.stand <= (zeit at time zone 'Europe/Berlin')::date order by z.stand desc limit 1),
      (select z.je_euro / u.je_euro from wechselkurse z join wechselkurse u on u.stand = z.stand and u.waehrung = 'USD'
        where z.waehrung = ziel order by z.stand limit 1))
  end
$$;

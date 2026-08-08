-- weight_lbs_current duplicated authoritative state that belongs to the
-- measurements table. Renaming to weight_lbs_start reframes this column as
-- immutable baseline data (starting weight when the goal cycle began);
-- current weight will be read from measurements in a later slice.

alter table goals
  rename column weight_lbs_current to weight_lbs_start;

# `ml/data/`

Source loaders live here (`synthetic.py`, `mimic.py`). **No datasets are
committed** - everything except `*.py`, this README and `.gitkeep` is
gitignored.

## Synthetic data (default)

`synthetic.py` generates a reproducible stand-in dataset with the same schema
and column semantics as the MIMIC-IV-ED extractor. It is created in memory by
the training script - nothing is written to disk. It is **not clinically
valid**; it exists so the pipeline and API can run end to end.

## MIMIC-IV-ED (real training)

MIMIC-IV-ED is credentialed and must not be added to this repository or shared.

1. Complete the CITI "Data or Specimens Only Research" training and sign the
   PhysioNet Credentialed Health Data Use Agreement.
2. Download **MIMIC-IV-ED** from
   <https://physionet.org/content/mimic-iv-ed/> (currently v2.2).
3. Unpack it so the `ed` module CSVs are together, e.g.:

   ```
   ml/data/mimic-iv-ed/
     edstays.csv.gz
     triage.csv.gz
     patients.csv.gz        # optional, from MIMIC-IV hosp module - enables `age`
   ```

4. Train against it:

   ```bash
   python -m ml.training.train --source mimic \
       --data-dir ml/data/mimic-iv-ed --model-version v2
   ```

Only `triage.*` (observations recorded at triage) and the arrival columns of
`edstays.*` are read. See `../features.md` for the per-column leakage
justification.

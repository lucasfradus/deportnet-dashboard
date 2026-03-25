import { TextField } from '@mui/material';

export default function TextFieldDate({ label, value, onChange, disabled, max }) {
  return (
    <TextField
      label={label}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      fullWidth
      size="small"
      InputLabelProps={{ shrink: true }}
      inputProps={max ? { max } : undefined}
    />
  );
}


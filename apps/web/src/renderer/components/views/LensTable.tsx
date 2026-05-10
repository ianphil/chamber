import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { formatTitle, formatDisplayValue } from '../../lib/utils';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export function LensTable({ data, schema }: Props) {
  // Data should be an array for table view
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [data];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data.</p>;

  // Derive columns from schema or first row
  const schemaProps = (schema as { items?: { properties?: Record<string, { title?: string }> } })?.items?.properties;
  const columns = schemaProps
    ? Object.keys(schemaProps)
    : Object.keys(rows[0]);

  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>
                {schemaProps?.[col]?.title ?? formatTitle(col)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col}>{formatDisplayValue(row[col])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

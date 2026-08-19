interface Props {
  message: string;
}

export function StatusBar({ message }: Props) {
  return <div className="status-bar">{message}</div>;
}

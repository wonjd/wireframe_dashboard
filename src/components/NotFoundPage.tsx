type Props = {
  code?: string;
  title: string;
  detail?: string;
};

/** Simple in-app 404 / empty state — not a route catch-all. */
export function NotFoundPage({ code = "404", title, detail }: Props) {
  return (
    <div className="wfs-404" role="status">
      <div className="wfs-404-code">{code}</div>
      <h1 className="wfs-404-title">{title}</h1>
      {detail ? <p className="wfs-404-detail">{detail}</p> : null}
    </div>
  );
}
